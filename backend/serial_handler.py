import time
import threading
import re
import math
import random
import serial
import serial.tools.list_ports

class SerialHandler:
    def __init__(self):
        self.port = None
        self.baudrate = 115200
        self.ser = None
        self.is_connected = False
        self.simulation_mode = True  # Defaults to simulation if no physical device is connected
        self.thread = None
        self.running = False
        self.lock = threading.Lock()

        # Telemetry state
        self.latest_data = {
            "temperature": 24.5,
            "humidity": 62.0,
            "light_value": 680,
            "led_state": True,
            "threshold": 700,
            "status_message": "Simulation Active",
            "last_updated": time.time(),
            "port": "SIMULATED",
            "is_simulation": True
        }

        # Rolling history for frontend analytics charts (up to 60 readings)
        self.history = []

        # Start background worker
        self.start()

    def get_available_ports(self):
        ports = []
        for p in serial.tools.list_ports.comports():
            ports.append({
                "device": p.device,
                "description": p.description,
                "hwid": p.hwid
            })
        return ports

    def connect(self, port_name, baudrate=115200):
        with self.lock:
            self.disconnect()
            try:
                self.ser = serial.Serial(port_name, baudrate=baudrate, timeout=1)
                self.port = port_name
                self.baudrate = baudrate
                self.is_connected = True
                self.simulation_mode = False
                self.latest_data["port"] = port_name
                self.latest_data["is_simulation"] = False
                self.latest_data["status_message"] = f"Connected to {port_name} at {baudrate} baud"
                return True, f"Successfully connected to {port_name}"
            except Exception as e:
                self.ser = None
                self.is_connected = False
                self.simulation_mode = True
                self.latest_data["port"] = "SIMULATED"
                self.latest_data["is_simulation"] = True
                self.latest_data["status_message"] = f"Connection error: {str(e)}. Reverting to simulation."
                return False, str(e)

    def disconnect(self):
        if self.ser:
            try:
                self.ser.close()
            except Exception:
                pass
            self.ser = None
        self.is_connected = False
        self.port = None

    def enable_simulation(self):
        with self.lock:
            self.disconnect()
            self.simulation_mode = True
            self.latest_data["port"] = "SIMULATED"
            self.latest_data["is_simulation"] = True
            self.latest_data["status_message"] = "Simulation Active"

    def start(self):
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self._worker_loop, daemon=True)
            self.thread.start()

    def stop(self):
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1.0)
        self.disconnect()

    def _worker_loop(self):
        # Auto-try to discover hardware if possible
        sim_step = 0
        while self.running:
            if self.is_connected and self.ser and self.ser.is_open:
                try:
                    line = self.ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        self._parse_line(line)
                except Exception as e:
                    with self.lock:
                        self.latest_data["status_message"] = f"Serial read error: {e}"
                        self.disconnect()
                        self.simulation_mode = True
                        self.latest_data["is_simulation"] = True
                        self.latest_data["port"] = "SIMULATED"
                time.sleep(0.05)
            else:
                # Simulation Mode: realistic dynamic agricultural telemetry
                sim_step += 1
                with self.lock:
                    base_temp = 25.0 + 3.0 * math.sin(sim_step * 0.05) + random.uniform(-0.3, 0.3)
                    base_humidity = 60.0 + 8.0 * math.cos(sim_step * 0.04) + random.uniform(-0.5, 0.5)
                    # Light fluctuates across dark and bright threshold
                    base_light = int(680 + 200 * math.sin(sim_step * 0.03) + random.uniform(-20, 20))
                    base_light = max(50, min(1023, base_light))

                    led_on = base_light < self.latest_data["threshold"]

                    self.latest_data["temperature"] = round(base_temp, 1)
                    self.latest_data["humidity"] = round(base_humidity, 1)
                    self.latest_data["light_value"] = base_light
                    self.latest_data["led_state"] = led_on
                    self.latest_data["last_updated"] = time.time()
                    self.latest_data["is_simulation"] = True
                    self.latest_data["port"] = "SIMULATED"
                    self.latest_data["status_message"] = "Simulating Real-Time Microcontroller Data"

                    self._record_history()
                time.sleep(1.5)

    def _parse_line(self, line: str):
        # Matches user's Arduino code prints:
        # "Temperature: 24.50 C"
        # "Humidity: 60.00 %"
        # "Light Value: 720"
        # "Dark - LED ON" / "Bright - LED OFF"
        # "DHT11 reading failed!"
        with self.lock:
            updated = False
            temp_match = re.search(r"Temperature:\s*([0-9.]+)", line, re.IGNORECASE)
            if temp_match:
                try:
                    self.latest_data["temperature"] = float(temp_match.group(1))
                    updated = True
                except ValueError:
                    pass

            hum_match = re.search(r"Humidity:\s*([0-9.]+)", line, re.IGNORECASE)
            if hum_match:
                try:
                    self.latest_data["humidity"] = float(hum_match.group(1))
                    updated = True
                except ValueError:
                    pass

            light_match = re.search(r"Light Value:\s*([0-9]+)", line, re.IGNORECASE)
            if light_match:
                try:
                    self.latest_data["light_value"] = int(light_match.group(1))
                    updated = True
                except ValueError:
                    pass

            if "LED ON" in line.upper():
                self.latest_data["led_state"] = True
                updated = True
            elif "LED OFF" in line.upper():
                self.latest_data["led_state"] = False
                updated = True
            elif "light_value" in self.latest_data:
                # Fallback to threshold rule if led line wasn't printed yet
                self.latest_data["led_state"] = self.latest_data["light_value"] < self.latest_data["threshold"]

            if "DHT11 reading failed!" in line:
                self.latest_data["status_message"] = "Warning: DHT11 Sensor Reading Failed (Check D2 wire)"

            if updated:
                self.latest_data["last_updated"] = time.time()
                self._record_history()

    def _record_history(self):
        entry = {
            "time": time.strftime("%H:%M:%S"),
            "temperature": self.latest_data["temperature"],
            "humidity": self.latest_data["humidity"],
            "light_value": self.latest_data["light_value"],
            "led_state": self.latest_data["led_state"]
        }
        self.history.append(entry)
        if len(self.history) > 60:
            self.history.pop(0)

    def set_manual_telemetry(self, temp=None, hum=None, light=None):
        """Allows testing custom conditions (e.g. extreme heat, dry drought, dark night)"""
        with self.lock:
            if temp is not None:
                self.latest_data["temperature"] = float(temp)
            if hum is not None:
                self.latest_data["humidity"] = float(hum)
            if light is not None:
                self.latest_data["light_value"] = int(light)
                self.latest_data["led_state"] = self.latest_data["light_value"] < self.latest_data["threshold"]
            self.latest_data["last_updated"] = time.time()
            self._record_history()

    def get_telemetry(self):
        with self.lock:
            return dict(self.latest_data)

    def get_history(self):
        with self.lock:
            return list(self.history)
