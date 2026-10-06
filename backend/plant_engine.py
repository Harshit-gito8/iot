import math
import time
import json
from typing import Dict, Any, List, Optional
from backend import database as db

class PlantGrowthEngine:
    def __init__(self):
        self.t_base = 10.0  # Base temperature for tomato/crops (10°C)
        self.last_tick = time.time()
        self.active_plant = db.get_active_plant()

    def calculate_vpd(self, temp_c: float, humidity_pct: float) -> float:
        """
        Calculates Vapor Pressure Deficit (VPD) in kPa using Tetens equation.
        VPD is the fundamental horticultural indicator for transpiration, stomatal conductance,
        and moisture stress.
        Optimal: 0.8 - 1.2 kPa
        Low (fungal risk): < 0.4 kPa
        High (wilting stress): > 1.6 kPa
        """
        temp = max(-10.0, min(60.0, temp_c))
        rh = max(5.0, min(100.0, humidity_pct))

        vp_sat = 0.61078 * math.exp((17.27 * temp) / (temp + 237.3))
        vp_act = vp_sat * (rh / 100.0)
        vpd = max(0.0, vp_sat - vp_act)
        return round(vpd, 2)

    def compute_turgor_factor(self, vpd: float, humidity: float, temp: float) -> float:
        """
        Calculates biological wilt/turgor factor from 0.0 (upright and rigid) to 1.0 (severely wilted).
        Based on physical transpiration deficit and extreme heat shock.
        """
        wilt = 0.0
        # High VPD causes excessive transpiration pull
        if vpd > 1.3:
            wilt += (vpd - 1.3) / 1.5 * 0.55
        # Low humidity dry air shock
        if humidity < 40.0:
            wilt += (40.0 - humidity) / 40.0 * 0.35
        # Heat wave stress
        if temp > 30.0:
            wilt += (temp - 30.0) / 15.0 * 0.30

        return round(min(0.95, max(0.0, wilt)), 3)

    def process_telemetry_tick(self, telemetry: Dict[str, Any]) -> Dict[str, Any]:
        """
        Called when new sensor data arrives.
        Updates GDD, growth metrics, and checks alert rules.
        """
        plant = db.get_active_plant()
        plant_id = plant["id"]

        temp = telemetry.get("temperature", 24.0)
        humidity = telemetry.get("humidity", 60.0)
        light = telemetry.get("light_value", 700)
        led = telemetry.get("led_state", False)

        vpd = self.calculate_vpd(temp, humidity)
        turgor_wilt = self.compute_turgor_factor(vpd, humidity, temp)

        # Record to SQLite database
        db.record_telemetry(plant_id, temp, humidity, light, led, vpd, source=telemetry.get("source", "serial"))

        # Calculate time delta for GDD accumulation
        now = time.time()
        elapsed_hours = (now - self.last_tick) / 3600.0
        self.last_tick = now

        # Don't increment crazy values if server just restarted
        if elapsed_hours > 2.0:
            elapsed_hours = 0.02

        # GDD increment: max(0, Temp - T_base) / 24 per hour
        gdd_increment = max(0.0, (temp - self.t_base) / 24.0) * elapsed_hours
        new_gdd = plant["total_gdd"] + gdd_increment

        # Light exposure accumulation (light > 400 counts as daylight)
        light_hrs_inc = (1.0 * elapsed_hours) if (light >= 400 or led) else 0.0
        new_light_hrs = plant["total_light_hrs"] + light_hrs_inc

        # Determine Phenological Growth Stage based on GDD
        stage = plant["growth_stage"]
        old_stage = stage
        if new_gdd < 60.0:
            stage = "seedling"
            expected_leaves = 4
            expected_height = 6.0
        elif new_gdd < 150.0:
            stage = "early_vegetative"
            expected_leaves = 6
            expected_height = 11.0
        elif new_gdd < 320.0:
            stage = "vegetative"
            expected_leaves = 9
            expected_height = 18.0
        elif new_gdd < 520.0:
            stage = "flowering"
            expected_leaves = 12
            expected_height = 26.0
        elif new_gdd < 780.0:
            stage = "fruiting"
            expected_leaves = 14
            expected_height = 32.0
        else:
            stage = "mature"
            expected_leaves = 15
            expected_height = 35.0

        leaf_count = max(plant["leaf_count"], expected_leaves)
        stem_height = max(plant["stem_height_cm"], expected_height)

        # Stage change event trigger
        if stage != old_stage:
            db.add_growth_event(
                plant_id,
                "stage_transition",
                f"Plant reached '{stage.replace('_', ' ').title()}' phenological stage (GDD: {new_gdd:.1f})",
                {"old_stage": old_stage, "new_stage": stage, "total_gdd": new_gdd}
            )

        # Update plant record
        db.update_plant(plant_id, {
            "total_gdd": round(new_gdd, 2),
            "total_light_hrs": round(new_light_hrs, 2),
            "growth_stage": stage,
            "leaf_count": leaf_count,
            "stem_height_cm": round(stem_height, 1)
        })

        # Evaluate automated alert triggers
        self._check_alerts(plant_id, temp, humidity, light, vpd)

        # Build full Digital Twin 3D State
        twin_state = self.get_twin_3d_state(plant_id, vpd, turgor_wilt)

        return {
            "plant_id": plant_id,
            "vpd": vpd,
            "turgor_wilt": turgor_wilt,
            "gdd": round(new_gdd, 1),
            "growth_stage": stage,
            "leaf_count": leaf_count,
            "stem_height_cm": stem_height,
            "twin_3d_state": twin_state
        }

    def _check_alerts(self, plant_id: int, temp: float, hum: float, light: int, vpd: float):
        if temp > 33.0:
            db.add_alert(plant_id, "heat_stress", "warning", f"High Temperature Alert: {temp:.1f}°C can cause blossom drop and stomatal closure.")
        elif temp < 14.0:
            db.add_alert(plant_id, "cold_stress", "warning", f"Low Temperature Alert: {temp:.1f}°C stunts root nutrient intake.")

        if hum > 82.0:
            db.add_alert(plant_id, "fungal_risk", "warning", f"High Humidity Alert: {hum:.1f}% creates conditions for fungal spore germination. Ensure ventilation.")
        elif hum < 35.0:
            db.add_alert(plant_id, "drought_stress", "info", f"Dry Air Alert: {hum:.1f}% increases transpiration water stress.")

        if vpd > 1.6:
            db.add_alert(plant_id, "vpd_stress", "warning", f"VPD is High ({vpd} kPa): Plant is transpiring water faster than roots can absorb.")
        elif vpd < 0.4:
            db.add_alert(plant_id, "vpd_low", "info", f"VPD is Low ({vpd} kPa): Stagnant air reduces nutrient flow.")

    def get_twin_3d_state(self, plant_id: Optional[int] = None, vpd: float = 1.0, wilt_factor: float = 0.0) -> Dict[str, Any]:
        """
        Produces detailed structural parameters for Three.js:
        - Exact number of leaves and their per-leaf health status
        - Stem height, curvature, and branching
        - Reproductive organs (flowers / fruits) according to stage
        """
        if not plant_id:
            plant = db.get_active_plant()
            plant_id = plant["id"]
        else:
            plant = db.get_active_plant()

        leaf_count = plant["leaf_count"]
        stage = plant["growth_stage"]
        health = plant["health_score"]

        # Get latest diagnosis to project disease onto leaves
        recent_diags = db.get_diagnoses_history(plant_id, limit=1)
        latest_diag = recent_diags[0] if recent_diags else None

        # Build individual leaf descriptors
        leaves = []
        for i in range(leaf_count):
            tier = "lower" if i < leaf_count * 0.3 else ("mid" if i < leaf_count * 0.7 else "upper")
            # Default healthy leaf
            l_disease = "healthy"
            l_health = health

            # Distribute lesions realistically across leaves if diseased
            if latest_diag and latest_diag.get("severity") != "HEALTHY":
                d_name = latest_diag.get("diagnosis_name", "")
                damage = latest_diag.get("damage_percentage", 0.0)
                # Lower and mid leaves suffer blight/mildew first
                if tier in ["lower", "mid"] and (i % 2 == 0 or damage > 20):
                    if "Mildew" in d_name:
                        l_disease = "mildew"
                    elif "Chlorosis" in d_name:
                        l_disease = "chlorosis"
                    else:
                        l_disease = "necrosis"
                    l_health = max(10, int(100 - damage * 1.8))

            leaves.append({
                "id": i,
                "tier": tier,
                "disease": l_disease,
                "health": l_health,
                "base_angle_rad": (i * 2.39996), # Golden ratio phyllotaxis angle
                "elevation_pct": (i + 1) / (leaf_count + 1)
            })

        has_flowers = stage in ["flowering", "fruiting", "mature"]
        has_fruit = stage in ["fruiting", "mature"]
        fruit_count = 3 if stage == "fruiting" else (5 if stage == "mature" else 0)

        return {
            "species": plant["species"],
            "stage": stage,
            "stem_height_cm": plant["stem_height_cm"],
            "stem_scale_y": max(0.6, min(1.6, plant["stem_height_cm"] / 18.0)),
            "leaf_count": leaf_count,
            "leaves": leaves,
            "vpd_kpa": vpd,
            "wilt_factor": wilt_factor,
            "has_flowers": has_flowers,
            "has_fruit": has_fruit,
            "fruit_count": fruit_count,
            "health_score": health
        }

    def execute_farmer_action(self, action_type: str, notes: str = "") -> Dict[str, Any]:
        """
        Simulates physical farmer field actions:
        - 'watering': instantly restores turgor pressure and soil hydration
        - 'pruning': removes diseased lower leaves
        - 'fertilizing': adds nutrient boost, accelerating GDD
        - 'fungicide_spray': cures foliar infection and restores health score
        """
        plant = db.get_active_plant()
        plant_id = plant["id"]

        if action_type == "watering":
            db.add_growth_event(plant_id, "watering", "Deep root watering applied by farmer", {"notes": notes})
            return {"success": True, "message": "Watering event logged. Soil moisture replenished."}

        elif action_type == "pruning":
            new_leaves = max(4, plant["leaf_count"] - 2)
            db.update_plant(plant_id, {"leaf_count": new_leaves, "health_score": min(100, plant["health_score"] + 15)})
            db.add_growth_event(plant_id, "pruning", f"Sanitary pruning removed infected foliage. Leaf count adjusted to {new_leaves}.", {"notes": notes})
            return {"success": True, "message": f"Pruning completed. {plant['leaf_count'] - new_leaves} infected leaves removed."}

        elif action_type == "fungicide_spray":
            db.update_plant(plant_id, {"health_score": 95})
            db.add_growth_event(plant_id, "treatment", "Fungicide / bio-pesticide spray applied to canopy.", {"notes": notes})
            return {"success": True, "message": "Treatment logged. Canopy health restored."}

        elif action_type == "fertilizing":
            db.update_plant(plant_id, {"total_gdd": plant["total_gdd"] + 15.0})
            db.add_growth_event(plant_id, "fertilizing", "Balanced organic nutrient feed applied.", {"notes": notes})
            return {"success": True, "message": "Nutrient feed applied. Vegetative growth stimulated."}

        return {"success": False, "message": "Unknown action type."}

plant_engine = PlantGrowthEngine()
