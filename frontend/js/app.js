/**
 * Main Smart Farming Dashboard Application Controller
 */

let digitalTwin = null;
let telemetryCharts = null;
let webcamStream = null;
let autoScanInterval = null;
let lastTelemetry = null;
let isAudioAlertEnabled = false;
let plantScanInProgress = false;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize 3D Digital Twin
    try {
        digitalTwin = new PlantDigitalTwin('digitalTwinCanvas');
    } catch (e) {
        console.error("Failed to initialize 3D Digital Twin:", e);
    }

    // 2. Initialize Telemetry Charts
    try {
        telemetryCharts = new TelemetryCharts();
    } catch (e) {
        console.error("Failed to initialize Charts:", e);
    }

    // 3. Setup UI Event Listeners
    setupEventListeners();

    // 4. Load COM Ports & Sample Library
    refreshPortsList();
    loadSampleImages();

    // 5. Start Telemetry Polling Loop
    startTelemetryLoop();
});

function setupEventListeners() {
    // Port Connection
    document.getElementById('btnConnect')?.addEventListener('click', handleConnectPort);
    document.getElementById('btnDisconnect')?.addEventListener('click', handleDisconnectPort);
    document.getElementById('btnSimulate')?.addEventListener('click', handleSimulateMode);
    document.getElementById('btnRefreshPorts')?.addEventListener('click', refreshPortsList);
    document.getElementById('btnResetPlantScan')?.addEventListener('click', resetPlantScanBaseline);

    // Camera Controls
    document.getElementById('btnStartCam')?.addEventListener('click', startWebcam);
    document.getElementById('btnStopCam')?.addEventListener('click', stopWebcam);
    document.getElementById('btnCaptureScan')?.addEventListener('click', captureAndDiagnose);
    document.getElementById('toggleAutoScan')?.addEventListener('change', handleAutoScanToggle);

    // Image Upload
    const fileInput = document.getElementById('imageFileInput');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    runDiagnosisOnImage(event.target.result);
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // 3D View Toggles
    document.getElementById('btnToggleWireframe')?.addEventListener('click', () => {
        if (digitalTwin) {
            const isWf = digitalTwin.toggleWireframe();
            document.getElementById('btnToggleWireframe').classList.toggle('active', isWf);
        }
    });

    // Manual Sandbox Override Sliders
    const sliderTemp = document.getElementById('sliderTemp');
    const sliderHum = document.getElementById('sliderHum');
    const sliderLight = document.getElementById('sliderLight');

    const updateSandbox = () => {
        if (!sliderTemp || !sliderHum || !sliderLight) return;
        document.getElementById('valTemp').textContent = sliderTemp.value + '°C';
        document.getElementById('valHum').textContent = sliderHum.value + '%';
        document.getElementById('valLight').textContent = sliderLight.value;

        fetch('/api/telemetry/override', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                temperature: parseFloat(sliderTemp.value),
                humidity: parseFloat(sliderHum.value),
                light_value: parseInt(sliderLight.value)
            })
        });
    };

    sliderTemp?.addEventListener('input', updateSandbox);
    sliderHum?.addEventListener('input', updateSandbox);
    sliderLight?.addEventListener('input', updateSandbox);

    // Print / Export Report
    document.getElementById('btnPrintReport')?.addEventListener('click', () => {
        window.print();
    });

    // Audio Alert Toggle
    const chkAudio = document.getElementById('chkAudioAlert');
    if (chkAudio) {
        chkAudio.addEventListener('change', (e) => {
            isAudioAlertEnabled = e.target.checked;
        });
    }
}

// --- COM Port Management ---

async function refreshPortsList() {
    try {
        const res = await fetch('/api/ports');
        const data = await res.json();
        const select = document.getElementById('portSelect');
        if (!select) return;

        select.innerHTML = '';
        if (data.ports && data.ports.length > 0) {
            data.ports.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.device;
                opt.textContent = `${p.device} (${p.description || 'Serial Device'})`;
                select.appendChild(opt);
            });
        } else {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No physical COM ports found (Use Simulation)';
            select.appendChild(opt);
        }

        updateConnectionBadge(data);
    } catch (e) {
        console.warn("Could not fetch ports:", e);
    }
}

async function handleConnectPort() {
    const portSelect = document.getElementById('portSelect');
    const port = portSelect ? portSelect.value : '';
    if (!port) {
        alert("Please select a valid COM port or click 'Simulation Mode'.");
        return;
    }

    try {
        const res = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: port, baudrate: 115200 })
        });
        const result = await res.json();
        if (res.ok) {
            showToast(`Connected to ${port}! Live sensor stream active.`, 'success');
        } else {
            showToast(`Failed: ${result.detail}`, 'error');
        }
        refreshPortsList();
    } catch (e) {
        showToast(`Connection error: ${e.message}`, 'error');
    }
}

async function handleDisconnectPort() {
    try {
        await fetch('/api/disconnect', { method: 'POST' });
        showToast("Disconnected. Switched to Simulation Mode.", 'info');
        refreshPortsList();
    } catch (e) {
        console.error(e);
    }
}

async function handleSimulateMode() {
    try {
        await fetch('/api/simulate', { method: 'POST' });
        showToast("Simulation Mode Activated.", 'info');
        refreshPortsList();
    } catch (e) {
        console.error(e);
    }
}

function updateConnectionBadge(data) {
    const badge = document.getElementById('connectionStatusBadge');
    if (!badge) return;

    if (data.is_connected && !data.is_simulation) {
        badge.innerHTML = `<span class="badge-dot dot-online"></span> Connected: <strong>${data.current_port}</strong> (115200 Baud)`;
        badge.className = "status-badge badge-success";
    } else {
        badge.innerHTML = `<span class="badge-dot dot-sim"></span> Source: <strong>Simulation Mode</strong>`;
        badge.className = "status-badge badge-sim";
    }
}

// --- Real-Time Telemetry Stream Loop ---

function startTelemetryLoop() {
    setInterval(async () => {
        try {
            const [telemetryRes, historyRes] = await Promise.all([
                fetch('/api/telemetry'),
                fetch('/api/history')
            ]);

            if (telemetryRes.ok) {
                const telemetry = await telemetryRes.json();
                lastTelemetry = telemetry;
                renderTelemetryUI(telemetry);

                if (digitalTwin) {
                    digitalTwin.updateTelemetry(telemetry);
                }
            }

            if (historyRes.ok) {
                const history = await historyRes.json();
                if (telemetryCharts) {
                    telemetryCharts.updateData(history);
                }
            }
        } catch (e) {
            console.warn("Telemetry polling tick error:", e);
        }
    }, 1500);
}

function renderTelemetryUI(t) {
    // 1. Temperature Card
    const tempEl = document.getElementById('metricTemp');
    if (tempEl) tempEl.textContent = t.temperature.toFixed(1);

    const tempStatus = document.getElementById('tempStatus');
    if (tempStatus) {
        if (t.temperature < 18) {
            tempStatus.textContent = 'Cool / Slow Growth';
            tempStatus.className = 'metric-status status-warn';
        } else if (t.temperature > 30) {
            tempStatus.textContent = 'Heat Stress Alert!';
            tempStatus.className = 'metric-status status-danger';
            playAlertSound();
        } else {
            tempStatus.textContent = 'Optimal Range (20-28°C)';
            tempStatus.className = 'metric-status status-good';
        }
    }

    // 2. Humidity Card
    const humEl = document.getElementById('metricHum');
    if (humEl) humEl.textContent = t.humidity.toFixed(1);

    const humStatus = document.getElementById('humStatus');
    if (humStatus) {
        if (t.humidity < 40) {
            humStatus.textContent = 'Low Moisture / Dry Air';
            humStatus.className = 'metric-status status-warn';
        } else if (t.humidity > 80) {
            humStatus.textContent = 'High Humidity / Fungal Risk!';
            humStatus.className = 'metric-status status-danger';
        } else {
            humStatus.textContent = 'Optimal Range (55-75%)';
            humStatus.className = 'metric-status status-good';
        }
    }

    // 3. Light Sensor Card (LDR)
    const lightEl = document.getElementById('metricLight');
    if (lightEl) lightEl.textContent = t.light_value;

    const lightStatus = document.getElementById('lightStatus');
    if (lightStatus) {
        if (t.light_value < (t.threshold || 700)) {
            lightStatus.textContent = `Dim / Night (< ${t.threshold})`;
            lightStatus.className = 'metric-status status-warn';
        } else {
            lightStatus.textContent = `Bright / Sunlit (>= ${t.threshold})`;
            lightStatus.className = 'metric-status status-good';
        }
    }

    // 4. LED Grow Light State Card
    const ledBadge = document.getElementById('metricLed');
    if (ledBadge) {
        if (t.led_state) {
            ledBadge.innerHTML = `<span class="led-indicator led-on"></span> ACTIVE (ON)`;
            ledBadge.className = 'led-card-state state-on';
        } else {
            ledBadge.innerHTML = `<span class="led-indicator led-off"></span> STANDBY (OFF)`;
            ledBadge.className = 'led-card-state state-off';
        }
    }

    // Microcontroller status message line
    const msgEl = document.getElementById('systemStatusText');
    if (msgEl && t.status_message) {
        msgEl.textContent = t.status_message;
    }
}

// --- Webcam & Vision Scanner ---

async function startWebcam() {
    const video = document.getElementById('webcamVideo');
    const placeholder = document.getElementById('cameraPlaceholder');
    const btnStart = document.getElementById('btnStartCam');
    const btnStop = document.getElementById('btnStopCam');

    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" }
        });
        if (video) {
            video.srcObject = webcamStream;
            video.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
        }
        if (btnStart) btnStart.style.display = 'none';
        if (btnStop) btnStop.style.display = 'inline-flex';
        showToast("Laptop camera started. Point towards plant foliage.", "success");
    } catch (err) {
        console.error("Camera access error:", err);
        showToast("Could not access camera: " + err.message + ". You can use Image Upload or Sample Leaves.", "error");
    }
}

function stopWebcam() {
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    const video = document.getElementById('webcamVideo');
    const placeholder = document.getElementById('cameraPlaceholder');
    const btnStart = document.getElementById('btnStartCam');
    const btnStop = document.getElementById('btnStopCam');

    if (video) video.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
    if (btnStart) btnStart.style.display = 'inline-flex';
    if (btnStop) btnStop.style.display = 'none';
}

function captureAndDiagnose() {
    const video = document.getElementById('webcamVideo');
    if (!webcamStream || !video || video.style.display === 'none') {
        showToast("Please click 'Start Camera' first or choose an image / sample leaf.", "warn");
        return;
    }

    // Capture current frame onto an off-screen canvas
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

    runDiagnosisOnImage(dataUrl, true);
}

function handleAutoScanToggle(e) {
    if (e.target.checked) {
        if (!webcamStream) {
            startWebcam().then(() => {
                startAutoScanInterval();
            });
        } else {
            startAutoScanInterval();
        }
    } else {
        if (autoScanInterval) {
            clearInterval(autoScanInterval);
            autoScanInterval = null;
        }
        showToast("Auto-scan stopped.", "info");
    }
}

function startAutoScanInterval() {
    if (autoScanInterval) clearInterval(autoScanInterval);
    showToast("Auto-Scan Active: Capturing plant inspection every 25 seconds.", "info");
    captureAndDiagnose();
    autoScanInterval = setInterval(() => {
        captureAndDiagnose();
    }, 25000);
}

// --- Sample Leaves Library ---

async function loadSampleImages() {
    try {
        const res = await fetch('/api/samples');
        const data = await res.json();
        const container = document.getElementById('samplesContainer');
        if (!container || !data.samples) return;

        container.innerHTML = '';
        data.samples.forEach(sample => {
            const btn = document.createElement('button');
            btn.className = 'sample-chip';
            btn.innerHTML = `<img src="${sample.image}" alt="${sample.name}" /> <span>${sample.name}</span>`;
            btn.addEventListener('click', () => {
                runDiagnosisOnImage(sample.image);
            });
            container.appendChild(btn);
        });
    } catch (e) {
        console.warn("Could not load sample images:", e);
    }
}

// --- Diagnosis Execution & Farmer Report Rendering ---

async function runDiagnosisOnImage(base64Image, trackPlant = false) {
    if (trackPlant && plantScanInProgress) return;
    if (trackPlant) plantScanInProgress = true;

    const scanLoader = document.getElementById('scanLoader');
    if (scanLoader) scanLoader.style.display = 'flex';

    try {
        const res = await fetch('/api/diagnose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: base64Image,
                include_sensor_context: true,
                track_plant: trackPlant
            })
        });

        const diagnosis = await res.json();

        if (res.ok && diagnosis.success) {
            renderDiagnosticReport(diagnosis);
            if (digitalTwin && diagnosis.has_plant) {
                digitalTwin.updateDiseaseState(diagnosis);
            }
            if (digitalTwin && diagnosis.plant_scan) {
                digitalTwin.updatePlantScan(diagnosis.plant_scan);
            }
            renderPlantScan(diagnosis.plant_scan);
            showToast(`Diagnosis Complete: ${diagnosis.diagnosis_name}`, 'success');
        } else {
            showToast(`Diagnosis failed: ${diagnosis.detail || 'Error'}`, 'error');
        }
    } catch (e) {
        showToast(`Diagnosis request error: ${e.message}`, 'error');
    } finally {
        if (scanLoader) scanLoader.style.display = 'none';
        if (trackPlant) plantScanInProgress = false;
    }
}

function renderPlantScan(scan) {
    const status = document.getElementById('hudPlantScan');
    if (!status || !scan) return;

    if (scan.status === 'no_plant') {
        status.textContent = 'Plant not detected · twin unchanged';
    } else if (scan.status === 'baseline') {
        status.textContent = `Baseline saved · canopy ${scan.width_pct.toFixed(1)}% × ${scan.height_pct.toFixed(1)}% of frame`;
    } else {
        const change = scan.coverage_change_pct;
        const direction = change > 1 ? 'larger' : (change < -1 ? 'smaller' : 'stable');
        status.textContent = `Scan ${scan.scan_number} · foliage ${change > 0 ? '+' : ''}${change.toFixed(1)}% (${direction})`;
    }
}

async function resetPlantScanBaseline() {
    try {
        const response = await fetch('/api/plant-scan/reset', { method: 'POST' });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        if (digitalTwin) digitalTwin.resetPlantScan();
        const status = document.getElementById('hudPlantScan');
        if (status) status.textContent = 'Baseline cleared · capture a new reference scan';
        showToast('Plant reference scan cleared. Capture the plant to set a new baseline.', 'info');
    } catch (error) {
        showToast(`Could not reset plant baseline: ${error.message}`, 'error');
    }
}

function renderDiagnosticReport(d) {
    // 1. Images (Original & Annotated Heatmap)
    const imgOrig = document.getElementById('diagImgOriginal');
    const imgAnnotated = document.getElementById('diagImgAnnotated');
    if (imgOrig) imgOrig.src = d.original_image;
    if (imgAnnotated) imgAnnotated.src = d.annotated_image;

    // 2. Main Badge & Disease Name
    const nameEl = document.getElementById('diagName');
    if (nameEl) nameEl.textContent = d.diagnosis_name;

    const pathogenEl = document.getElementById('diagPathogen');
    if (pathogenEl) pathogenEl.textContent = d.pathogen_type;

    const severityEl = document.getElementById('diagSeverity');
    if (severityEl) {
        severityEl.textContent = d.severity;
        severityEl.className = `severity-badge severity-${d.severity.toLowerCase()}`;
    }

    const healthGauge = document.getElementById('diagHealthScore');
    if (healthGauge) {
        healthGauge.textContent = `${d.health_score}/100`;
        healthGauge.style.color = d.health_score > 80 ? '#2ecc71' : (d.health_score > 50 ? '#f39c12' : '#e74c3c');
    }

    // 3. Quantitative Damage Metrics
    const damageEl = document.getElementById('metricDamagePct');
    if (damageEl) damageEl.textContent = `${d.damage_percentage}%`;

    const necroticEl = document.getElementById('metricNecroticPct');
    if (necroticEl && d.metrics) necroticEl.textContent = `${d.metrics.necrotic_percentage}%`;

    const chlorosisEl = document.getElementById('metricChlorosisPct');
    if (chlorosisEl && d.metrics) chlorosisEl.textContent = `${d.metrics.chlorosis_percentage}%`;

    const mildewEl = document.getElementById('metricMildewPct');
    if (mildewEl && d.metrics) mildewEl.textContent = `${d.metrics.mildew_percentage}%`;

    // 4. Symptoms Breakdown
    const symptomsEl = document.getElementById('diagSymptoms');
    if (symptomsEl) symptomsEl.textContent = d.primary_symptoms;

    // 5. Environmental IoT Sensor Warnings
    const warningsBox = document.getElementById('sensorWarningsBox');
    const warningsList = document.getElementById('sensorWarningsList');
    if (warningsBox && warningsList) {
        if (d.sensor_correlations && d.sensor_correlations.length > 0) {
            warningsBox.style.display = 'block';
            warningsList.innerHTML = d.sensor_correlations.map(w => `<li>${w}</li>`).join('');
        } else {
            warningsBox.style.display = 'none';
            warningsList.innerHTML = '';
        }
    }

    // 6. Action & Treatment Plan for Farmer
    const act = d.farmer_action_plan || {};
    const immEl = document.getElementById('planImmediate');
    if (immEl) immEl.textContent = act.immediate_action || 'None';

    const orgEl = document.getElementById('planOrganic');
    if (orgEl) orgEl.textContent = act.organic_treatment || 'None';

    const chemEl = document.getElementById('planChemical');
    if (chemEl) chemEl.textContent = act.chemical_treatment || 'None';

    // 7. Gemini Insights (if present)
    const geminiBox = document.getElementById('geminiBox');
    const geminiText = document.getElementById('geminiText');
    if (geminiBox && geminiText) {
        if (d.gemini_insights) {
            geminiBox.style.display = 'block';
            geminiText.textContent = d.gemini_insights;
        } else {
            geminiBox.style.display = 'none';
        }
    }

    // 8. Timestamp
    const timeEl = document.getElementById('diagTimestamp');
    if (timeEl) timeEl.textContent = `Report generated: ${d.timestamp}`;

    // Play warning sound if critical
    if (d.severity === "CRITICAL" || d.health_score < 40) {
        playAlertSound();
    }
}

// --- Audio & Toast Utilities ---

function playAlertSound() {
    if (!isAudioAlertEnabled) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.4);
    } catch (e) { }
}

function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 20);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3800);
}
