try:
    import uvicorn  # type: ignore[import-not-found]
except ModuleNotFoundError:
    uvicorn = None

import webbrowser
import threading
import time
import sys

# Ensure UTF-8 output on Windows consoles
if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

def open_browser():
    time.sleep(1.8)
    print("\n>>> Opening AgriTwin Pro Dashboard in your browser: http://localhost:8000\n")
    webbrowser.open("http://localhost:8000")

if __name__ == "__main__":
    print("=" * 65)
    print(" AgriTwin Pro: Smart Farming Digital Twin & AI Crop Health")
    print("=" * 65)
    print(" - Microcontroller Serial Baud Rate: 115200")
    print(" - Sensors: DHT11 (D2), LDR (A0), LED (D5)")
    print(" - Plant Pathology Vision Engine: OpenCV & Computer Vision")
    print(" - Digital Twin: Three.js Real-Time 3D Simulation")
    print("=" * 65)

    threading.Thread(target=open_browser, daemon=True).start()

    # Start FastAPI / Uvicorn server
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=False)
