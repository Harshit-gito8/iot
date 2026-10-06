import os
import json
import base64
import asyncio
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend import database as db
from backend.serial_handler import serial_handler
from backend.plant_engine import plant_engine
from backend.vision_engine import VisionEngine

app = FastAPI(title="AgriTwin Pro - Smart Farming Digital Twin API", version="2.0.0")

# Enable CORS safely
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

vision_engine = VisionEngine()

# Active WebSocket connections pool
active_websockets: List[WebSocket] = []

def broadcast_telemetry(telemetry: Dict[str, Any], growth_result: Dict[str, Any]):
    """Dispatched by serial_handler background thread on every sensor tick"""
    if not active_websockets:
        return

    payload = {
        "type": "telemetry",
        "telemetry": telemetry,
        "growth": growth_result
    }
    msg_str = json.dumps(payload)

    # Schedule sending in the asyncio loop safely
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            for ws in list(active_websockets):
                asyncio.run_coroutine_threadsafe(send_ws_safe(ws, msg_str), loop)
    except Exception:
        pass

async def send_ws_safe(ws: WebSocket, message: str):
    try:
        await ws.send_text(message)
    except Exception:
        if ws in active_websockets:
            active_websockets.remove(ws)

# Register callback with serial handler
serial_handler.register_callback(broadcast_telemetry)

# Pydantic request models
class ConnectRequest(BaseModel):
    port: str
    baudrate: Optional[int] = 115200

class DiagnoseRequest(BaseModel):
    image: str
    include_sensor_context: Optional[bool] = True
    track_plant: bool = False

class TelemetryOverrideRequest(BaseModel):
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    light_value: Optional[int] = None

class FarmerActionRequest(BaseModel):
    action_type: str  # 'watering', 'pruning', 'fertilizing', 'fungicide_spray'
    notes: Optional[str] = ""

class ActuatorLedRequest(BaseModel):
    state: bool

# --- WebSocket Streaming Endpoint ---

@app.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)

    # Send initial state immediately
    plant = db.get_active_plant()
    telemetry = serial_handler.get_telemetry()
    twin_3d = plant_engine.get_twin_3d_state(plant["id"], telemetry.get("vpd", 1.0), telemetry.get("turgor_wilt", 0.0))

    initial_payload = {
        "type": "init",
        "plant": plant,
        "telemetry": telemetry,
        "twin_3d": twin_3d,
        "alerts": db.get_alerts(plant["id"], limit=5)
    }
    await websocket.send_text(json.dumps(initial_payload))

    try:
        while True:
            # Handle client-to-server bi-directional commands
            data = await websocket.receive_text()
            cmd = json.loads(data)
            action = cmd.get("action")
            if action == "set_led":
                state = bool(cmd.get("state", False))
                serial_handler.set_actuator_led(state)
            elif action == "farmer_action":
                act_type = cmd.get("action_type")
                res = plant_engine.execute_farmer_action(act_type, cmd.get("notes", ""))
                await websocket.send_text(json.dumps({"type": "action_result", "result": res}))
    except WebSocketDisconnect:
        if websocket in active_websockets:
            active_websockets.remove(websocket)
    except Exception:
        if websocket in active_websockets:
            active_websockets.remove(websocket)

# --- REST Endpoints ---

@app.get("/api/plant")
def get_plant():
    plant = db.get_active_plant()
    stats = {
        "plant": plant,
        "events": db.get_growth_events(plant["id"], limit=10),
        "recent_diagnoses": db.get_diagnoses_history(plant["id"], limit=5)
    }
    return stats

@app.get("/api/plant/twin")
def get_plant_twin():
    plant = db.get_active_plant()
    telemetry = serial_handler.get_telemetry()
    twin_state = plant_engine.get_twin_3d_state(plant["id"], telemetry.get("vpd", 1.0), telemetry.get("turgor_wilt", 0.0))
    return twin_state

@app.post("/api/plant/action")
def execute_plant_action(req: FarmerActionRequest):
    result = plant_engine.execute_farmer_action(req.action_type, req.notes)
    return result

@app.post("/api/actuators/led")
def set_actuator_led(req: ActuatorLedRequest):
    success = serial_handler.set_actuator_led(req.state)
    return {"success": success, "led_state": req.state}

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
    return serial_handler.get_telemetry()

@app.get("/api/history")
def get_history(limit: int = 60, hours: Optional[float] = None):
    plant = db.get_active_plant()
    history = db.get_telemetry_history(plant["id"], limit=limit, hours=hours)
    # Format for chart consumption
    formatted = []
    for h in history:
        t_str = h["timestamp"]
        if " " in t_str:
            t_str = t_str.split(" ")[1]
        formatted.append({
            "time": t_str,
            "temperature": h["temperature"],
            "humidity": h["humidity"],
            "light_value": h["light_value"],
            "led_state": bool(h["led_state"]),
            "vpd": h.get("vpd", 1.0)
        })
    return formatted

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

@app.get("/api/diagnoses/history")
def get_diagnoses_history(limit: int = 15):
    plant = db.get_active_plant()
    return db.get_diagnoses_history(plant["id"], limit=limit)

@app.get("/api/growth/events")
def get_growth_events(limit: int = 25):
    plant = db.get_active_plant()
    return db.get_growth_events(plant["id"], limit=limit)

@app.get("/api/alerts")
def get_alerts(limit: int = 20):
    plant = db.get_active_plant()
    return db.get_alerts(plant["id"], limit=limit)

@app.post("/api/alerts/mark-read")
def mark_alerts_read():
    plant = db.get_active_plant()
    db.mark_alerts_read(plant["id"])
    return {"success": True}

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
