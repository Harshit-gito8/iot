import os
import json
import base64
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional

from backend.serial_handler import SerialHandler
from backend.vision_engine import VisionEngine

app = FastAPI(title="Smart Farming Digital Twin API", version="1.0.0")

# Enable CORS for local cross-origin development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

serial_handler = SerialHandler()
vision_engine = VisionEngine()

# Pydantic models
class ConnectRequest(BaseModel):
    port: str
    baudrate: Optional[int] = 115200

class DiagnoseRequest(BaseModel):
    image: str  # base64 encoded image string
    include_sensor_context: Optional[bool] = True
    track_plant: bool = False

class TelemetryOverrideRequest(BaseModel):
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    light_value: Optional[int] = None

# --- API Endpoints ---

@app.get("/api/ports")
def get_ports():
    ports = serial_handler.get_available_ports()
    telemetry = serial_handler.get_telemetry()
    return {
        "ports": ports,
        "current_port": telemetry.get("port"),
        "is_connected": serial_handler.is_connected,
        "is_simulation": telemetry.get("is_simulation", True),
        "status_message": telemetry.get("status_message")
    }

@app.post("/api/connect")
def connect_port(req: ConnectRequest):
    success, msg = serial_handler.connect(req.port, req.baudrate)
    if not success:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True, "message": msg, "port": req.port}

@app.post("/api/disconnect")
def disconnect_port():
    serial_handler.disconnect()
    serial_handler.enable_simulation()
    return {"success": True, "message": "Disconnected. Switched to Simulation Mode."}

@app.post("/api/simulate")
def enable_simulate():
    serial_handler.enable_simulation()
    return {"success": True, "message": "Simulation Mode enabled."}

@app.get("/api/telemetry")
def get_telemetry():
    data = serial_handler.get_telemetry()
    return data

@app.get("/api/history")
def get_history():
    return serial_handler.get_history()

@app.post("/api/telemetry/override")
def override_telemetry(req: TelemetryOverrideRequest):
    serial_handler.set_manual_telemetry(req.temperature, req.humidity, req.light_value)
    return {"success": True, "telemetry": serial_handler.get_telemetry()}

@app.post("/api/diagnose")
def diagnose_plant(req: DiagnoseRequest):
    sensor_context = serial_handler.get_telemetry() if req.include_sensor_context else None
    result = vision_engine.analyze_plant_image(req.image, sensor_context, req.track_plant)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Analysis failed"))
    return result

@app.post("/api/plant-scan/reset")
def reset_plant_scan():
    vision_engine.reset_plant_scan()
    return {"success": True, "message": "Plant scan baseline reset."}

@app.get("/api/samples")
def get_samples():
    sample_dir = os.path.join(os.path.dirname(__file__), "..", "samples")
    samples = []
    if os.path.exists(sample_dir):
        for fname in os.listdir(sample_dir):
            if fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                filepath = os.path.join(sample_dir, fname)
                with open(filepath, "rb") as f:
                    b64 = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode('utf-8')
                name = fname.replace("sample_", "").replace(".jpg", "").replace("_", " ").title()
                samples.append({
                    "id": fname,
                    "name": name,
                    "image": b64
                })
    return {"samples": samples}

# Mount static frontend
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
