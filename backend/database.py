import sqlite3
import os
import json
import time
from typing import List, Dict, Optional, Any

DB_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
DB_PATH = os.path.join(DB_DIR, "agritwin.db")

def get_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS plants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        species TEXT NOT NULL DEFAULT 'Solanum lycopersicum (Tomato)',
        planted_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        growth_stage TEXT NOT NULL DEFAULT 'vegetative',
        total_gdd REAL DEFAULT 145.0,
        total_light_hrs REAL DEFAULT 48.0,
        leaf_count INTEGER DEFAULT 8,
        stem_height_cm REAL DEFAULT 14.5,
        health_score INTEGER DEFAULT 95,
        is_active BOOLEAN DEFAULT 1,
        notes TEXT DEFAULT 'Primary Digital Twin specimen'
    );

    CREATE TABLE IF NOT EXISTS telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plant_id INTEGER NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        temperature REAL NOT NULL,
        humidity REAL NOT NULL,
        light_value INTEGER NOT NULL,
        led_state BOOLEAN NOT NULL,
        vpd REAL DEFAULT 0.0,
        source TEXT DEFAULT 'serial',
        FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS diagnoses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plant_id INTEGER NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        diagnosis_name TEXT NOT NULL,
        pathogen_type TEXT,
        severity TEXT NOT NULL,
        health_score INTEGER NOT NULL,
        damage_percentage REAL NOT NULL,
        necrotic_pct REAL DEFAULT 0.0,
        chlorosis_pct REAL DEFAULT 0.0,
        mildew_pct REAL DEFAULT 0.0,
        primary_symptoms TEXT,
        immediate_action TEXT,
        organic_treatment TEXT,
        chemical_treatment TEXT,
        sensor_correlations TEXT,
        annotated_image TEXT,
        original_image TEXT,
        FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS growth_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plant_id INTEGER NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        event_type TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plant_id INTEGER NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT 0,
        FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_plant_time ON telemetry(plant_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_diagnoses_plant_time ON diagnoses(plant_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_plant_read ON alerts(plant_id, is_read);
    """)

    # Check if default plant exists, create if empty
    cursor.execute("SELECT id FROM plants WHERE is_active = 1 LIMIT 1")
    row = cursor.fetchone()
    if not row:
        cursor.execute("""
            INSERT INTO plants (name, species, growth_stage, total_gdd, total_light_hrs, leaf_count, stem_height_cm, health_score)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, ("Solanum Specimen #1", "Solanum lycopersicum (Tomato)", "vegetative", 160.0, 52.0, 9, 16.5, 96))
        plant_id = cursor.lastrowid
        cursor.execute("""
            INSERT INTO growth_events (plant_id, event_type, description, metadata)
            VALUES (?, ?, ?, ?)
        """, (plant_id, "planted", "Digital Twin initialized with vegetative tomato specimen", json.dumps({"source": "system_init"})))

    conn.commit()
    conn.close()

def get_active_plant() -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM plants WHERE is_active = 1 ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    init_db()
    return get_active_plant()

def update_plant(plant_id: int, updates: Dict[str, Any]):
    conn = get_connection()
    cursor = conn.cursor()
    fields = []
    values = []
    for k, v in updates.items():
        fields.append(f"{k} = ?")
        values.append(v)
    values.append(plant_id)
    query = f"UPDATE plants SET {', '.join(fields)} WHERE id = ?"
    cursor.execute(query, values)
    conn.commit()
    conn.close()

def record_telemetry(plant_id: int, temp: float, hum: float, light: int, led: bool, vpd: float, source: str = "serial"):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO telemetry (plant_id, temperature, humidity, light_value, led_state, vpd, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (plant_id, temp, hum, light, int(led), vpd, source))
    conn.commit()
    conn.close()

def get_telemetry_history(plant_id: int, limit: int = 60, hours: Optional[float] = None) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    if hours:
        cursor.execute("""
            SELECT * FROM telemetry
            WHERE plant_id = ? AND datetime(timestamp) >= datetime('now', ?)
            ORDER BY timestamp ASC
        """, (plant_id, f"-{hours} hours"))
    else:
        cursor.execute("""
            SELECT * FROM (
                SELECT * FROM telemetry WHERE plant_id = ? ORDER BY id DESC LIMIT ?
            ) ORDER BY id ASC
        """, (plant_id, limit))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def record_diagnosis(plant_id: int, diag: Dict[str, Any]) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO diagnoses (
            plant_id, diagnosis_name, pathogen_type, severity, health_score,
            damage_percentage, necrotic_pct, chlorosis_pct, mildew_pct,
            primary_symptoms, immediate_action, organic_treatment, chemical_treatment,
            sensor_correlations, annotated_image, original_image
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        plant_id,
        diag.get("diagnosis_name", "Unknown"),
        diag.get("pathogen_type", "None"),
        diag.get("severity", "HEALTHY"),
        diag.get("health_score", 100),
        diag.get("damage_percentage", 0.0),
        diag.get("metrics", {}).get("necrotic_percentage", 0.0),
        diag.get("metrics", {}).get("chlorosis_percentage", 0.0),
        diag.get("metrics", {}).get("mildew_percentage", 0.0),
        diag.get("primary_symptoms", ""),
        diag.get("farmer_action_plan", {}).get("immediate_action", ""),
        diag.get("farmer_action_plan", {}).get("organic_treatment", ""),
        diag.get("farmer_action_plan", {}).get("chemical_treatment", ""),
        json.dumps(diag.get("sensor_correlations", [])),
        diag.get("annotated_image", ""),
        diag.get("original_image", "")
    ))
    diag_id = cursor.lastrowid

    # Update plant overall health score in plants table
    cursor.execute("UPDATE plants SET health_score = ? WHERE id = ?", (diag.get("health_score", 100), plant_id))

    # Log growth event
    cursor.execute("""
        INSERT INTO growth_events (plant_id, event_type, description, metadata)
        VALUES (?, ?, ?, ?)
    """, (plant_id, "diagnosis", f"Pathology scan: {diag.get('diagnosis_name')} ({diag.get('severity')})", json.dumps({"diag_id": diag_id, "score": diag.get("health_score")})))

    conn.commit()
    conn.close()
    return diag_id

def get_diagnoses_history(plant_id: int, limit: int = 15) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    # Don't return huge base64 strings in list queries to save bandwidth
    cursor.execute("""
        SELECT id, plant_id, timestamp, diagnosis_name, pathogen_type, severity,
               health_score, damage_percentage, necrotic_pct, chlorosis_pct, mildew_pct,
               primary_symptoms, immediate_action, organic_treatment, chemical_treatment,
               sensor_correlations
        FROM diagnoses
        WHERE plant_id = ?
        ORDER BY id DESC LIMIT ?
    """, (plant_id, limit))
    rows = cursor.fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        if d.get("sensor_correlations"):
            try:
                d["sensor_correlations"] = json.loads(d["sensor_correlations"])
            except Exception:
                d["sensor_correlations"] = []
        result.append(d)
    return result

def add_growth_event(plant_id: int, event_type: str, description: str, metadata: Optional[Dict[str, Any]] = None):
    conn = get_connection()
    cursor = conn.cursor()
    meta_str = json.dumps(metadata) if metadata else None
    cursor.execute("""
        INSERT INTO growth_events (plant_id, event_type, description, metadata)
        VALUES (?, ?, ?, ?)
    """, (plant_id, event_type, description, meta_str))
    conn.commit()
    conn.close()

def get_growth_events(plant_id: int, limit: int = 25) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM growth_events WHERE plant_id = ? ORDER BY id DESC LIMIT ?
    """, (plant_id, limit))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def add_alert(plant_id: int, alert_type: str, severity: str, message: str) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO alerts (plant_id, alert_type, severity, message, is_read)
        VALUES (?, ?, ?, ?, 0)
    """, (plant_id, alert_type, severity, message))
    alert_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return alert_id

def get_alerts(plant_id: int, limit: int = 20) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM alerts WHERE plant_id = ? ORDER BY id DESC LIMIT ?
    """, (plant_id, limit))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def mark_alerts_read(plant_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE alerts SET is_read = 1 WHERE plant_id = ?", (plant_id,))
    conn.commit()
    conn.close()

# Auto-initialize DB on import
init_db()
