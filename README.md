# 🌾 AgriTwin Pro: Smart Farming Digital Twin & AI Crop Health Inspector

An IoT and computer-vision farming dashboard that combines microclimate telemetry (DHT11 temperature and humidity, LDR light level, grow lamp) with webcam scans for crop-health reporting and a scan-updated **3D plant estimate**. With the current single RGB webcam, this is not an exact depth-aware reconstruction or a system that physically changes the plant.

---

## 🚀 Key Features

1. **Physical Microcontroller & Serial Communication (`115200 Baud`)**:
   - Reads your Arduino / ESP8266 / NodeMCU serial outputs:
     - `Temperature: <val> C`
     - `Humidity: <val> %`
     - `Light Value: <val>`
     - `Dark - LED ON` / `Bright - LED OFF`
   - Auto-discovers connected USB COM ports (e.g. `COM3`, `COM4`, etc.) and seamlessly connects.
   - Built-in realistic telemetry simulation when no hardware is plugged in, so you can test immediately.

2. **Laptop Webcam Plant Scanner**:
   - Uses laptop webcam (`navigator.mediaDevices.getUserMedia`) for real-time plant foliage inspection.
   - **Auto-Scan Mode**: Automatically snaps and diagnoses the plant every 25 seconds.
   - Live camera scans compare visible foliage coverage and silhouette with a reference scan, then resize the 3D canopy to reflect estimated growth or shrinkage.
   - Use **New Plant Baseline** when switching plants. Scan tracking is held in backend memory and resets when the server restarts.
   - **Photo Upload**: Supports uploading existing field images (JPEG, PNG).
   - **Sample Crop Library**: Test immediately with built-in samples (*Healthy*, *Early Blight*, *Powdery Mildew*, *Chlorosis*).

3. **Computer Vision & Disease Diagnostic Engine (OpenCV)**:
   - Segments plant foliage and isolates **necrotic lesions**, **chlorosis (yellowing)**, and **powdery mildew mycelium**.
   - Calculates quantitative damage percentages, health score (0–100), and pathogen classification.
   - Generates side-by-side **Original Foliage vs Annotated Diagnostic Heatmap** with bounding boxes.
   - **Environmental Correlation Engine**: Correlates high humidity (>78%) or heatwaves with disease propagation risks.
   - **Action Protocol for Farmers**:
     - *Immediate Containment* (pruning, quarantine, airflow)
     - *Organic / Biological Remedy* (cold-pressed Neem oil, potassium bicarbonate, bio-fungicides)
     - *Commercial Solutions* (copper hydroxide, Mancozeb, Azoxystrobin)
     - One-click **Print / Save PDF Report**.

4. **Camera-Tracked 3D Plant Estimate (Three.js WebGL)**:
   - Repeated webcam scans update the estimated canopy size; detected disease and environmental telemetry continue to update color and wilting.
   - This is not an exact 3D reconstruction: a single RGB camera cannot reliably measure depth or identify individual broken leaves. Keep the whole plant in frame at a fixed distance, angle, and lighting; camera movement can look like plant growth or loss.
   - **Dynamic Turgor Pressure & Wilting**: Leaves droop downwards in 3D when humidity drops or heat stress occurs; perk up when optimal.
   - **3D Grow Luminaire Sync**: Overhead LED luminaire turns ON with warm grow bloom when light is dim (`< 700`), matching your Arduino logic.
   - **Atmospheric Sunlight**: Ambient scene illumination smoothly tracks the LDR sensor (0–1023).
   - **Pathological Foliar Shifting**: Leaf color dynamically turns yellow (chlorosis) or spotted necrotic brown (blight/rust) when disease is detected.
   - **Biometric Wireframe Mode** & 360° OrbitControls.

---

## 🔌 Hardware Circuit & Pinout

| Sensor / Actuator | Microcontroller Pin | Description |
|---|---|---|
| **DHT11 Data Pin** | **D2** (GPIO 4) | Temperature & Humidity reading |
| **DHT11 VCC / GND** | **3.3V / GND** | Sensor power |
| **LDR (Light Sensor)** | **A0** (Analog In) | Voltage divider (LDR + 10kΩ resistor) |
| **Grow LED** | **D5** (GPIO 14) | Indicator / Grow Light (`< 700` turns ON) |

> 📁 Arduino sketch is saved in [`arduino/smart_farm_sensor.ino`](file:///c:/Users/ASUS/Desktop/iot%20project/arduino/smart_farm_sensor.ino). Flash it using Arduino IDE at **115200 baud**.

---

## 💻 How to Run the Application

### 1. One-Click Launch (Windows)
Double-click `run.bat` in this folder:
```cmd
run.bat
```
*Or via terminal:*
```powershell
python run.py
```
This automatically starts the FastAPI backend server and opens your browser at **`http://localhost:8000`**.

### 2. Connect Your Microcontroller
1. Plug your ESP8266 / Arduino into your laptop USB port.
2. In the top navigation bar, select your board's COM port from the dropdown (e.g. `COM5`).
3. Click **"Connect"**.
4. The dashboard will instantly stream live sensor values from your board!
*(If no board is connected, click **"Simulation"** to test with the realistic virtual telemetry).*

### 3. Inspect Crop with Laptop Camera
1. Keep the webcam at a fixed distance and angle, with the entire plant in view and consistent lighting.
2. Click **"Start Camera"** followed by **"Capture & Diagnose"** (or turn on **"Auto-Scan"**).
3. Capture the first scan to establish the plant baseline. Later live scans and Auto-Scan compare the visible silhouette and foliage coverage, update the estimated 3D canopy, detect disease, and correlate findings with sensor readings. Use **New Plant Baseline** when starting a different plant. Uploaded photos and sample images diagnose disease but do not change plant scan tracking.

---

## 📂 Project Architecture

```
iot project/
├── arduino/
│   └── smart_farm_sensor.ino   # Microcontroller sketch (DHT11, LDR, LED)
├── backend/
│   ├── main.py                 # FastAPI backend with REST & static serving
│   ├── serial_handler.py       # Serial port auto-detection, parser, and simulation
│   └── vision_engine.py        # OpenCV plant disease segmentation & diagnostic engine
├── frontend/
│   ├── index.html              # Modern glassmorphism dashboard UI
│   ├── css/
│   │   └── style.css           # Responsive styles and print agronomy layout
│   └── js/
│       ├── app.js              # Application controller, camera, and API sync
│       ├── digital_twin.js     # Three.js 3D Digital Twin simulation
│       └── charts.js           # Real-time Chart.js telemetry timelines
├── samples/                    # Sample leaf images for instant testing
│   ├── sample_healthy.jpg
│   ├── sample_early_blight.jpg
│   ├── sample_powdery_mildew.jpg
│   └── sample_chlorosis.jpg
├── requirements.txt            # Python dependencies
├── run.py                      # Python launcher with automatic browser opening
├── run.bat                     # Windows one-click batch launcher
└── README.md
```
