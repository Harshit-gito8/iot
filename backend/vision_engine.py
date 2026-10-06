import cv2
import numpy as np
import base64
import time
import os
import json
import threading
import urllib.request
from backend import database as db

class VisionEngine:
    def __init__(self):
        # Optional Gemini API key for hybrid cloud AI agronomy
        self.gemini_api_key = os.environ.get("GEMINI_API_KEY", "")
        self._plant_scan_lock = threading.Lock()
        self._plant_scan_baseline = None
        self._plant_scan_number = 0

    def reset_plant_scan(self):
        with self._plant_scan_lock:
            self._plant_scan_baseline = None
            self._plant_scan_number = 0

    def decode_base64_image(self, base64_str: str) -> np.ndarray:
        if "," in base64_str:
            base64_str = base64_str.split(",")[1]
        img_bytes = base64.b64decode(base64_str)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img

    def encode_image_base64(self, img: np.ndarray) -> str:
        _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 88])
        return "data:image/jpeg;base64," + base64.b64encode(buffer).decode('utf-8')

    def analyze_plant_image(self, image_input, sensor_context: dict = None, track_plant: bool = False) -> dict:
        """
        Processes plant leaf image, segments lesions, measures disease severity,
        correlates with sensor readings, and produces diagnostic report and annotated visual overlay.
        """
        start_time = time.time()

        if isinstance(image_input, str):
            img = self.decode_base64_image(image_input)
        else:
            img = image_input

        if img is None or img.size == 0:
            return {
                "success": False,
                "error": "Failed to decode image or empty image provided."
            }

        # Resize to standard processing resolution (max width 800)
        h, w = img.shape[:2]
        if w > 800:
            scale = 800.0 / w
            img = cv2.resize(img, (800, int(h * scale)))
            h, w = img.shape[:2]

        annotated_img = img.copy()
        heatmap_overlay = img.copy()

        # Convert to HSV and LAB color spaces
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)

        # 1. Segment Foliage / Plant Area
        # General green vegetation mask
        lower_green1 = np.array([25, 30, 30])
        upper_green1 = np.array([88, 255, 255])
        green_mask1 = cv2.inRange(hsv, lower_green1, upper_green1)

        # Yellowish green / chlorotic plant tissue
        lower_yellow = np.array([16, 40, 50])
        upper_yellow = np.array([34, 255, 255])
        yellow_mask = cv2.inRange(hsv, lower_yellow, upper_yellow)

        # Brownish / necrotic leaf tissue
        lower_brown = np.array([8, 50, 20])
        upper_brown = np.array([24, 255, 180])
        brown_mask = cv2.inRange(hsv, lower_brown, upper_brown)

        # Overall Plant Mask
        raw_plant_mask = cv2.bitwise_or(green_mask1, yellow_mask)
        raw_plant_mask = cv2.bitwise_or(raw_plant_mask, brown_mask)

        # Fill internal holes inside leaf (so pale/white spots on the leaf are included in the leaf domain)
        leaf_contours, _ = cv2.findContours(raw_plant_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        plant_mask = np.zeros_like(raw_plant_mask)
        for cnt in leaf_contours:
            if cv2.contourArea(cnt) > 300:
                cv2.drawContours(plant_mask, [cnt], -1, 255, -1)

        # Fallback if no large contour found
        if cv2.countNonZero(plant_mask) == 0:
            plant_mask = raw_plant_mask

        # Morphological clean up
        kernel_plant = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        plant_mask = cv2.morphologyEx(plant_mask, cv2.MORPH_CLOSE, kernel_plant)

        total_pixels = h * w
        plant_pixels = cv2.countNonZero(plant_mask)
        plant_coverage = (plant_pixels / total_pixels) * 100.0
        if plant_pixels:
            _, _, plant_width, plant_height = cv2.boundingRect(plant_mask)
            silhouette_width = plant_width / w * 100.0
            silhouette_height = plant_height / h * 100.0
        else:
            silhouette_width = 0.0
            silhouette_height = 0.0

        # If very little plant tissue is found, inspect whether it's an extreme close-up or no plant
        has_plant = plant_coverage > 3.0
        plant_scan = self._track_plant_scan(
            has_plant,
            plant_coverage,
            silhouette_width,
            silhouette_height
        ) if track_plant else None

        # 2. Lesion & Symptom Analysis
        # A. Necrosis / Dark Lesions / Blight / Rust
        # Dark brown or dead dried spots inside plant mask
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        contrast_gray = clahe.apply(gray)

        # High-contrast dark spot detection inside leaf
        _, dark_thresh = cv2.threshold(contrast_gray, 80, 255, cv2.THRESH_BINARY_INV)
        dark_lesion_mask = cv2.bitwise_and(dark_thresh, plant_mask)
        necrotic_combined = cv2.bitwise_or(brown_mask, dark_lesion_mask)
        necrotic_combined = cv2.bitwise_and(necrotic_combined, plant_mask)

        # B. Chlorosis (Yellowing / Nutrient deficiency / Viral mottling)
        chlorosis_mask = cv2.bitwise_and(yellow_mask, plant_mask)
        # Remove brown overlap from chlorosis
        chlorosis_mask = cv2.bitwise_and(chlorosis_mask, cv2.bitwise_not(brown_mask))

        # C. Powdery Mildew / Fungal mold (Pale / powdery spots)
        # High value (brightness) and low saturation inside leaf
        s_channel = hsv[:, :, 1]
        v_channel = hsv[:, :, 2]
        _, low_sat = cv2.threshold(s_channel, 45, 255, cv2.THRESH_BINARY_INV)
        _, high_val = cv2.threshold(v_channel, 175, 255, cv2.THRESH_BINARY)
        mildew_candidates = cv2.bitwise_and(low_sat, high_val)
        mildew_mask = cv2.bitwise_and(mildew_candidates, plant_mask)

        # Calculate metrics
        effective_plant_area = max(plant_pixels, 1)
        necrotic_pixels = cv2.countNonZero(necrotic_combined)
        chlorosis_pixels = cv2.countNonZero(chlorosis_mask)
        mildew_pixels = cv2.countNonZero(mildew_mask)

        necrotic_ratio = (necrotic_pixels / effective_plant_area) * 100.0
        chlorosis_ratio = (chlorosis_pixels / effective_plant_area) * 100.0
        mildew_ratio = (mildew_pixels / effective_plant_area) * 100.0

        # Total symptomatic lesion area (avoiding double count via bitwise OR)
        total_lesion_mask = cv2.bitwise_or(necrotic_combined, chlorosis_mask)
        total_lesion_mask = cv2.bitwise_or(total_lesion_mask, mildew_mask)
        total_lesion_pixels = cv2.countNonZero(total_lesion_mask)
        damage_percentage = min(100.0, (total_lesion_pixels / effective_plant_area) * 100.0)

        # 3. Contour Detection & Visual Diagnostics Annotation
        contours_necrosis, _ = cv2.findContours(necrotic_combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours_chlorosis, _ = cv2.findContours(chlorosis_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours_mildew, _ = cv2.findContours(mildew_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        lesion_boxes = []

        # Color highlight masks for diagnostic heatmap
        # Red for necrosis, Yellow for chlorosis, Cyan for mildew
        heatmap_overlay[necrotic_combined > 0] = [0, 30, 240]    # Red / Brown necrosis
        heatmap_overlay[chlorosis_mask > 0] = [20, 210, 240]    # Yellow chlorosis
        heatmap_overlay[mildew_mask > 0] = [230, 210, 50]       # Cyan / powdery fungal

        # Blend heatmap overlay with original image (40% overlay, 60% original)
        cv2.addWeighted(heatmap_overlay, 0.45, annotated_img, 0.55, 0, annotated_img)

        # Draw contour highlights on prominent lesions
        for cnt in contours_necrosis:
            area = cv2.contourArea(cnt)
            if area > 80:
                x, y, bw, bh = cv2.boundingRect(cnt)
                cv2.rectangle(annotated_img, (x, y), (x + bw, y + bh), (0, 0, 255), 2)
                lesion_boxes.append({"type": "Necrosis", "box": [x, y, bw, bh], "area": int(area)})

        for cnt in contours_chlorosis:
            area = cv2.contourArea(cnt)
            if area > 150:
                x, y, bw, bh = cv2.boundingRect(cnt)
                cv2.rectangle(annotated_img, (x, y), (x + bw, y + bh), (0, 220, 255), 2)
                lesion_boxes.append({"type": "Chlorosis", "box": [x, y, bw, bh], "area": int(area)})

        for cnt in contours_mildew:
            area = cv2.contourArea(cnt)
            if area > 120:
                x, y, bw, bh = cv2.boundingRect(cnt)
                cv2.rectangle(annotated_img, (x, y), (x + bw, y + bh), (255, 230, 0), 2)
                lesion_boxes.append({"type": "Mildew", "box": [x, y, bw, bh], "area": int(area)})

        # Header status badge drawn on the annotated image
        cv2.rectangle(annotated_img, (0, 0), (w, 55), (20, 25, 30), -1)
        font = cv2.FONT_HERSHEY_SIMPLEX

        # 4. Disease Classification Logic & Diagnosis Report
        if not has_plant:
            diagnosis_name = "No Plant Detected / Partial View"
            severity = "UNCERTAIN"
            severity_color = (150, 150, 150)
            health_score = 50
            primary_issue = "Camera is not focused on green plant foliage. Please reposition the laptop webcam."
            remedy = "Align plant leaf directly in the camera frame with adequate lighting."
            organic_cure = "N/A"
            chemical_cure = "N/A"
            pathogen_type = "None"
        elif damage_percentage < 3.5:
            diagnosis_name = "Healthy Plant (Optimal Vigour)"
            severity = "HEALTHY"
            severity_color = (0, 220, 50)
            health_score = 98
            primary_issue = "No significant pathogens, pest bites, or chlorotic lesions detected. Photosynthetic foliage is lush and active."
            remedy = "Maintain current watering, light exposure, and nutrient schedule."
            organic_cure = "Preventative application of seaweed extract or mild compost tea every 14 days."
            chemical_cure = "None required."
            pathogen_type = "None (Healthy)"
        elif mildew_ratio > 4.0 and mildew_ratio >= necrotic_ratio:
            diagnosis_name = "Powdery Mildew (Erysiphales Fungal Strain)"
            severity = "MODERATE" if mildew_ratio < 15 else "CRITICAL"
            severity_color = (255, 200, 0)
            health_score = max(10, int(100 - damage_percentage * 1.5))
            primary_issue = f"Fungal mycelium growth detected on leaf upper epidermis ({mildew_ratio:.1f}% surface coverage). Powdery white/gray fungal spores impair gas exchange and sunlight absorption."
            remedy = "Prune heavily infected lower leaves immediately. Avoid overhead watering to prevent spore dispersal."
            organic_cure = "Spray potassium bicarbonate (3g/L) or cold-pressed Neem oil (5ml/L + drops of mild soap) every 5 days."
            chemical_cure = "Azoxystrobin or Myclobutanil systemic fungicide if infection exceeds 25%."
            pathogen_type = "Fungal Infection"
        elif necrotic_ratio > 6.0:
            if chlorosis_ratio > 8.0:
                diagnosis_name = "Early Blight & Foliar Necrosis (Alternaria / Septoria)"
                pathogen_type = "Fungal Pathogen"
            else:
                diagnosis_name = "Leaf Spot & Necrotic Lesions (Bacterial / Fungal)"
                pathogen_type = "Fungal / Bacterial Complex"
            severity = "MODERATE" if damage_percentage < 20 else "CRITICAL"
            severity_color = (0, 0, 255)
            health_score = max(5, int(100 - damage_percentage * 1.6))
            primary_issue = f"Distinct necrotic target-like brown spots and cellular breakdown detected ({necrotic_ratio:.1f}% necrotic tissue)."
            remedy = "Remove and burn/bag fallen dead leaves. Sanitize pruning shears with 70% isopropyl alcohol."
            organic_cure = "Copper octanoate liquid spray or Bacillus subtilis bio-fungicide weekly."
            chemical_cure = "Mancozeb 75% WP (2g/L) or Chlorothalonil protectant fungicide."
        elif chlorosis_ratio > 8.0:
            diagnosis_name = "Interveinal Chlorosis (Nutrient Deficiency / Stress)"
            pathogen_type = "Physiological / Abiotic Stress"
            severity = "MILD" if chlorosis_ratio < 18 else "MODERATE"
            severity_color = (0, 220, 255)
            health_score = max(20, int(100 - chlorosis_ratio * 1.2))
            primary_issue = f"Chlorophyll depletion detected ({chlorosis_ratio:.1f}% yellowing). Leaves cannot produce enough sugars, likely caused by low Nitrogen, Iron lockout, or root over-saturation."
            remedy = "Check soil drainage and root aeration. Test soil pH (ideal range 6.0 - 6.8)."
            organic_cure = "Apply foliar chelated iron (Fe-EDTA) and balanced fish-kelp emulsion fertilizer."
            chemical_cure = "Water-soluble 19:19:19 NPK micronutrient foliar spray."
        else:
            diagnosis_name = "Mild Foliar Stress / Leaf Margin Scorch"
            pathogen_type = "Environmental Stress"
            severity = "MILD"
            severity_color = (0, 200, 200)
            health_score = max(40, int(100 - damage_percentage * 1.3))
            primary_issue = f"Mild tissue stress or mechanical leaf wear detected ({damage_percentage:.1f}% affected area)."
            remedy = "Monitor plant environment closely. Ensure adequate humidity and steady light."
            organic_cure = "Mild silica foliar boost to strengthen leaf cell walls."
            chemical_cure = "None required at this stage."

        # Correlate with IoT Sensor Telemetry (DHT11 & LDR)
        sensor_warnings = []
        if sensor_context:
            temp = sensor_context.get("temperature", 24)
            hum = sensor_context.get("humidity", 60)
            light = sensor_context.get("light_value", 700)
            led = sensor_context.get("led_state", False)

            if hum > 78 and "Fungal" in pathogen_type:
                sensor_warnings.append(
                    f"[HIGH HUMIDITY ALERT] Ambient humidity is currently {hum}%. Fungal spores require moisture films to penetrate stomata. Increase air ventilation and dry out surrounding canopy."
                )
            elif hum < 35:
                sensor_warnings.append(
                    f"[DRY AIR STRESS] Very low humidity ({hum}%) increases transpiration shock, exacerbating crispy leaf tips."
                )

            if temp > 33:
                sensor_warnings.append(
                    f"[HEAT WAVE ALERT] High temperature ({temp}°C) degrades chlorophyll and induces stomatal closure."
                )
            elif temp < 15:
                sensor_warnings.append(
                    f"[COLD STRESS ALERT] Low temperature ({temp}°C) stunts metabolic uptake of micronutrients like Phosphorus and Iron."
                )

            if light < 450 and not led:
                sensor_warnings.append(
                    f"[LOW LIGHT ALERT] Plant light sensor indicates low light exposure ({light}). Ensure grow LED is active."
                )

        # Draw status text on image
        cv2.putText(annotated_img, f"DIAGNOSIS: {diagnosis_name}", (12, 24), font, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(annotated_img, f"SEVERITY: {severity} | DAMAGE: {damage_percentage:.1f}% | HEALTH: {health_score}/100",
                    (12, 44), font, 0.45, severity_color, 1, cv2.LINE_AA)

        annotated_base64 = self.encode_image_base64(annotated_img)
        original_base64 = self.encode_image_base64(img)

        # Optional Gemini Vision enhancement if API key exists
        gemini_insights = None
        if self.gemini_api_key and has_plant:
            gemini_insights = self._query_gemini_vision(original_base64, diagnosis_name, damage_percentage, sensor_context)

        execution_time = round(time.time() - start_time, 2)

        result_payload = {
            "success": True,
            "has_plant": has_plant,
            "diagnosis_name": diagnosis_name,
            "pathogen_type": pathogen_type,
            "severity": severity,
            "health_score": health_score,
            "damage_percentage": round(damage_percentage, 1),
            "plant_scan": plant_scan,
            "metrics": {
                "necrotic_percentage": round(necrotic_ratio, 1),
                "chlorosis_percentage": round(chlorosis_ratio, 1),
                "mildew_percentage": round(mildew_ratio, 1),
                "plant_coverage_percentage": round(plant_coverage, 1),
                "lesion_count": len(lesion_boxes)
            },
            "primary_symptoms": primary_issue,
            "farmer_action_plan": {
                "immediate_action": remedy,
                "organic_treatment": organic_cure,
                "chemical_treatment": chemical_cure
            },
            "sensor_correlations": sensor_warnings,
            "gemini_insights": gemini_insights,
            "annotated_image": annotated_base64,
            "original_image": original_base64,
            "execution_time_sec": execution_time,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        }

        # Persist diagnosis in SQLite database for plant health timeline
        if has_plant:
            try:
                plant = db.get_active_plant()
                diag_id = db.record_diagnosis(plant["id"], result_payload)
                result_payload["diagnosis_id"] = diag_id
            except Exception as e:
                print(f"Error persisting diagnosis to DB: {e}")

        return result_payload

    def _track_plant_scan(self, has_plant: bool, coverage: float, width: float, height: float) -> dict:
        with self._plant_scan_lock:
            if not has_plant:
                return {
                    "status": "no_plant",
                    "message": "No plant silhouette was detected; the twin and baseline were not changed."
                }

            self._plant_scan_number += 1
            current = {"coverage_pct": coverage, "width_pct": width, "height_pct": height}

            if self._plant_scan_baseline is None:
                self._plant_scan_baseline = current
                return {
                    "status": "baseline",
                    "scan_number": self._plant_scan_number,
                    **current,
                    "coverage_change_pct": 0.0,
                    "width_change_pct": 0.0,
                    "height_change_pct": 0.0,
                    "twin_scale": {"x": 1.0, "y": 1.0, "z": 1.0},
                    "message": "Reference scan saved. Keep camera position, distance, and lighting consistent."
                }

            baseline = self._plant_scan_baseline

            def relative_change(value: float, reference: float) -> float:
                return (value / reference - 1.0) * 100.0 if reference > 0 else 0.0

            width_scale = width / baseline["width_pct"] if baseline["width_pct"] > 0 else 1.0
            height_scale = height / baseline["height_pct"] if baseline["height_pct"] > 0 else 1.0
            coverage_scale = coverage / baseline["coverage_pct"] if baseline["coverage_pct"] > 0 else 1.0
            fullness_scale = max(0.7, min(1.3, (coverage_scale / max(width_scale * height_scale, 0.01)) ** 0.5))

            return {
                "status": "updated",
                "scan_number": self._plant_scan_number,
                **current,
                "coverage_change_pct": round(relative_change(coverage, baseline["coverage_pct"]), 1),
                "width_change_pct": round(relative_change(width, baseline["width_pct"]), 1),
                "height_change_pct": round(relative_change(height, baseline["height_pct"]), 1),
                "twin_scale": {
                    "x": round(max(0.5, min(1.8, width_scale * fullness_scale)), 3),
                    "y": round(max(0.5, min(1.8, height_scale * fullness_scale)), 3),
                    "z": round(max(0.5, min(1.8, width_scale * fullness_scale)), 3)
                },
                "message": "Approximate 2D silhouette change from the reference scan; camera movement can affect this estimate."
            }

    def _query_gemini_vision(self, img_b64: str, diagnosis: str, damage: float, sensor_data: dict):
        """Optional query to Google Gemini Vision for deep agronomic consultation if API key is provided."""
        try:
            # Secure header-based API key transfer (no key in URL query parameter)
            url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

            sensor_str = ""
            if sensor_data:
                sensor_str = f"Live Sensors: Temperature {sensor_data.get('temperature')}C, Humidity {sensor_data.get('humidity')}%, Light {sensor_data.get('light_value')}."

            prompt = (
                f"You are an expert plant pathologist and agronomist. Computer vision detected '{diagnosis}' with {damage:.1f}% damage. {sensor_str} "
                "Provide a concise 3-bullet advice for the farmer sitting at home on how to save the plant, optimize yield, and prevent crop failure."
            )

            payload = {
                "contents": [{
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": "image/jpeg",
                                "data": clean_b64
                            }
                        }
                    ]
                }]
            }

            headers = {
                'Content-Type': 'application/json',
                'x-goog-api-key': self.gemini_api_key
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode('utf-8'),
                headers=headers
            )
            with urllib.request.urlopen(req, timeout=6) as response:
                res_data = json.loads(response.read().decode('utf-8'))
                text = res_data['candidates'][0]['content']['parts'][0]['text']
                return text
        except Exception as e:
            return None
