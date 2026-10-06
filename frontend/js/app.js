/**
 * AgriTwin Pro v2.0 - Application Controller
 * Handles WebSockets, 3D Digital Twin sync, Camera Scanner, Actuation, and Tabs
 */

let digitalTwin = null;
let telemetryCharts = null;
let webcamStream = null;
let autoScanInterval = null;
let wsConnection = null;
let audioContextInstance = null;
let currentLedState = false;
let activePlantData = null;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize 3D Digital Twin
    try {
        digitalTwin = new PlantDigitalTwin('digitalTwinCanvas');
        digitalTwin.onActuatorToggle = (actuator) => {
            if (actuator === "led") toggleGrowLightActuator();
        };
    } catch (e) {
        console.error("3D Digital Twin initialization error:", e);
    }

    // 2. Initialize Telemetry Charts
    try {
        telemetryCharts = new TelemetryCharts();
    } catch (e) {
        console.error("Charts initialization error:", e);
    }

    // 3. Setup Navigation, Tabs, and Themes
    setupTabs();
    setupThemeToggle();
    setupEventListeners();

    // 4. Discover COM Ports & Sample Leaves
    refreshPortsList();
    loadSampleImages();
    loadGrowthEvents();

    // 5. Establish Real-Time WebSocket Connection (with fallback)
    initWebSocketTelemetry();
});

// --- Tab Controller ---
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-tab');

            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetContent = document.getElementById(targetId);
            if (targetContent) targetContent.classList.add('active');

            // Resize Three.js & Charts when tab becomes visible
            if (targetId === 'tabTwin' && digitalTwin) digitalTwin.onResize();
            if (targetId === 'tabTelemetry' && telemetryCharts) {
                if (telemetryCharts.tempHumChart) telemetryCharts.tempHumChart.resize();
                if (telemetryCharts.lightVpdChart) telemetryCharts.lightVpdChart.resize();
            }
            if (targetId === 'tabTimeline') loadGrowthEvents();
        });
    });
}

// --- Theme Switcher ---
function setupThemeToggle() {
    const btn = document.getElementById('btnThemeToggle');
    if (!btn) return;

    const savedTheme = localStorage.getItem('agritwin_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    btn.textContent = savedTheme === 'light' ? '🌙' : '☀️';

    btn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('agritwin_theme', next);
        btn.textContent = next === 'light' ? '🌙' : '☀️';
    });
}

// --- Event Listeners ---
function setupEventListeners() {
    // Port Controls
    document.getElementById('btnConnect')?.addEventListener('click', handleConnectPort);
    document.getElementById('btnDisconnect')?.addEventListener('click', handleDisconnectPort);
    document.getElementById('btnSimulate')?.addEventListener('click', handleSimulateMode);

    // Actuators & Actions
    document.getElementById('btnToggleLampActuator')?.addEventListener('click', toggleGrowLightActuator);
    document.getElementById('btnActionWater')?.addEventListener('click', () => executeFarmerAction('watering'));
    document.getElementById('btnActionPrune')?.addEventListener('click', () => executeFarmerAction('pruning'));
    document.getElementById('btnActionFeed')?.addEventListener('click', () => executeFarmerAction('fertilizing'));

    // Camera
    document.getElementById('btnStartCam')?.addEventListener('click', startWebcam);
    document.getElementById('btnStopCam')?.addEventListener('click', stopWebcam);
    document.getElementById('btnCaptureScan')?.addEventListener('click', captureAndDiagnose);
    document.getElementById('toggleAutoScan')?.addEventListener('change', handleAutoScanToggle);

    // Wireframe
    document.getElementById('btnToggleWireframe')?.addEventListener('click', () => {
        if (digitalTwin) {
            const isWf = digitalTwin.toggleWireframe();
            document.getElementById('btnToggleWireframe').classList.toggle('active', isWf);
        }
    });

    // File Upload
    document.getElementById('imageFileInput')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => runDiagnosisOnImage(event.target.result);
            reader.readAsDataURL(file);
        }
    });

    // Range Sliders
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

    // Timeframe selector
    document.querySelectorAll('.btn-timeframe').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-timeframe').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const hours = btn.getAttribute('data-hours');
            fetchTelemetryHistory(hours);
        });
    });

    // Notifications panel
    const bellBtn = document.getElementById('btnNotifBell');
    const dropdown = document.getElementById('notifDropdown');
    bellBtn?.addEventListener('click', () => {
        dropdown?.classList.toggle('show');
    });

    document.getElementById('btnMarkAlertsRead')?.addEventListener('click', async () => {
        await fetch('/api/alerts/mark-read', { method: 'POST' });
        const badge = document.getElementById('notifCount');
        if (badge) badge.style.display = 'none';
        dropdown?.classList.remove('show');
    });

    // Print Report
    document.getElementById('btnPrintReport')?.addEventListener('click', () => window.print());
}

// --- WebSocket Real-Time Streaming ---
function initWebSocketTelemetry() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/telemetry`;

    try {
        wsConnection = new WebSocket(wsUrl);

        wsConnection.onopen = () => {
            console.log("WebSocket stream connected to AgriTwin Pro backend.");
        };

        wsConnection.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'telemetry' || msg.type === 'init') {
                    handleLiveTelemetryPacket(msg);
                }
            } catch (err) {
                console.error("WebSocket message parsing error:", err);
            }
        };

        wsConnection.onclose = () => {
            console.warn("WebSocket closed. Falling back to HTTP polling.");
            startHttpPollingFallback();
        };

        wsConnection.onerror = () => {
            console.warn("WebSocket error. Falling back to HTTP polling.");
            startHttpPollingFallback();
        };
    } catch (e) {
        startHttpPollingFallback();
    }
}

let pollingFallbackTimer = null;
function startHttpPollingFallback() {
    if (pollingFallbackTimer) return;
    pollingFallbackTimer = setInterval(async () => {
        try {
            const [telRes, plantRes] = await Promise.all([
                fetch('/api/telemetry'),
                fetch('/api/plant')
            ]);
            if (telRes.ok) {
                const telemetry = await telRes.json();
                handleLiveTelemetryPacket({ type: 'telemetry', telemetry: telemetry });
            }
        } catch (e) {}
    }, 1500);
}

function handleLiveTelemetryPacket(packet) {
    const t = packet.telemetry;
    if (!t) return;

    currentLedState = t.led_state;

    // Update Quick Telemetry Cards
    document.getElementById('quickTemp').textContent = t.temperature.toFixed(1);
    document.getElementById('quickHum').textContent = t.humidity.toFixed(1);
    document.getElementById('quickVpd').textContent = (t.vpd || 1.05).toFixed(2);

    // Update LED Badge
    const ledBadge = document.getElementById('quickLed');
    if (ledBadge) {
        if (t.led_state) {
            ledBadge.innerHTML = `<span class="led-indicator led-on"></span> ACTIVE (ON)`;
            ledBadge.className = 'led-card-state state-on';
        } else {
            ledBadge.innerHTML = `<span class="led-indicator led-off"></span> STANDBY (OFF)`;
            ledBadge.className = 'led-card-state state-off';
        }
    }

    // Update HUD status chips
    const vpdVal = t.vpd || 1.05;
    let vpdLabel = "Optimal (0.8 - 1.2 kPa)";
    if (vpdVal > 1.4) vpdLabel = `${vpdVal.toFixed(2)} kPa (High Transpiration Stress)`;
    else if (vpdVal < 0.5) vpdLabel = `${vpdVal.toFixed(2)} kPa (Low Transpiration / Fungal Risk)`;
    else vpdLabel = `${vpdVal.toFixed(2)} kPa (Optimal)`;
    document.getElementById('hudVpd').textContent = vpdLabel;

    // Update 3D Digital Twin
    if (digitalTwin) {
        digitalTwin.updateState(t, packet.growth);
    }

    // Append to rolling Chart history
    if (telemetryCharts) {
        fetchTelemetryHistory();
    }
}

async function fetchTelemetryHistory(hours = null) {
    try {
        const url = hours ? `/api/history?hours=${hours}` : `/api/history?limit=30`;
        const res = await fetch(url);
        if (res.ok) {
            const history = await res.json();
            if (telemetryCharts) telemetryCharts.updateData(history);
        }
    } catch (e) {}
}

// --- Virtual-to-Physical Actuator Controls ---
async function toggleGrowLightActuator() {
    const nextState = !currentLedState;
    try {
        const res = await fetch('/api/actuators/led', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: nextState })
        });
        if (res.ok) {
            currentLedState = nextState;
            showToast(`Grow Luminaire turned ${nextState ? 'ON' : 'OFF'}`, 'success');
        }
    } catch (e) {
        showToast(`Actuator command error: ${e.message}`, 'error');
    }
}

async function executeFarmerAction(actionType) {
    try {
        const res = await fetch('/api/plant/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action_type: actionType, notes: "Triggered from digital twin interface" })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            loadGrowthEvents();
            // Re-sync plant twin
            const twinRes = await fetch('/api/plant/twin');
            if (twinRes.ok) {
                const twinState = await twinRes.json();
                if (digitalTwin) digitalTwin.rebuildPlantModel(twinState);
            }
        }
    } catch (e) {
        showToast(`Action failed: ${e.message}`, 'error');
    }
}

// --- Plant Lifecycle & Events Table ---
async function loadGrowthEvents() {
    try {
        const [plantRes, eventsRes] = await Promise.all([
            fetch('/api/plant'),
            fetch('/api/growth/events')
        ]);

        if (plantRes.ok) {
            const pData = await plantRes.json();
            const plant = pData.plant;
            activePlantData = plant;

            document.getElementById('timelineStageName').textContent = plant.growth_stage.replace('_', ' ').toUpperCase();
            document.getElementById('timelineGdd').textContent = plant.total_gdd.toFixed(1);
            document.getElementById('timelineHeight').textContent = `${plant.stem_height_cm.toFixed(1)} cm`;
            document.getElementById('timelineLeaves').textContent = `${plant.leaf_count} Leaves`;
            document.getElementById('timelineLightHrs').textContent = `${plant.total_light_hrs.toFixed(1)} hrs`;
            document.getElementById('hudStage').textContent = plant.growth_stage.replace('_', ' ').toUpperCase();
            document.getElementById('hudLeafCount').textContent = `${plant.leaf_count} Leaves`;

            // Stage progress calculation
            let pct = 20;
            if (plant.growth_stage === 'early_vegetative') pct = 35;
            else if (plant.growth_stage === 'vegetative') pct = 55;
            else if (plant.growth_stage === 'flowering') pct = 75;
            else if (plant.growth_stage === 'fruiting') pct = 90;
            else if (plant.growth_stage === 'mature') pct = 100;
            document.getElementById('timelineProgressBar').style.width = `${pct}%`;
        }

        if (eventsRes.ok) {
            const events = await eventsRes.json();
            const tbody = document.getElementById('growthEventsTableBody');
            if (tbody) {
                tbody.innerHTML = '';
                if (events.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No events recorded yet</td></tr>';
                } else {
                    events.forEach(ev => {
                        const tr = document.createElement('tr');
                        const tdTime = document.createElement('td');
                        tdTime.textContent = ev.timestamp;
                        const tdType = document.createElement('td');
                        tdType.innerHTML = `<span class="badge-success" style="padding:2px 8px; border-radius:10px; font-size:10px;">${ev.event_type.toUpperCase()}</span>`;
                        const tdDesc = document.createElement('td');
                        tdDesc.textContent = ev.description;
                        tr.appendChild(tdTime);
                        tr.appendChild(tdType);
                        tr.appendChild(tdDesc);
                        tbody.appendChild(tr);
                    });
                }
            }
        }
    } catch (e) {}
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
                opt.textContent = `${p.device} (${p.description || 'Serial'})`;
                select.appendChild(opt);
            });
        } else {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Simulation Mode';
            select.appendChild(opt);
        }

        const badge = document.getElementById('connectionStatusBadge');
        if (badge) {
            if (data.is_connected && !data.is_simulation) {
                badge.innerHTML = `<span class="badge-dot dot-online"></span> Connected: <strong>${data.current_port}</strong>`;
                badge.className = "status-badge badge-success";
            } else {
                badge.innerHTML = `<span class="badge-dot dot-sim"></span> Source: <strong>Simulation</strong>`;
                badge.className = "status-badge badge-sim";
            }
        }
    } catch (e) {}
}

async function handleConnectPort() {
    const portSelect = document.getElementById('portSelect');
    const port = portSelect ? portSelect.value : '';
    if (!port) {
        showToast("Please choose a valid serial port", "warn");
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
            showToast(`Connected to ${port} (115200 Baud)`, 'success');
            refreshPortsList();
        } else {
            showToast(`Connection failed: ${result.detail}`, 'error');
        }
    } catch (e) {
        showToast(`Connection error: ${e.message}`, 'error');
    }
}

async function handleDisconnectPort() {
    await fetch('/api/disconnect', { method: 'POST' });
    showToast("Switched to Simulation Mode", 'info');
    refreshPortsList();
}

async function handleSimulateMode() {
    await fetch('/api/simulate', { method: 'POST' });
    showToast("Simulation Active", 'info');
    refreshPortsList();
}

// --- Webcam Scanner & Diagnosis ---
async function startWebcam() {
    const video = document.getElementById('webcamVideo');
    const placeholder = document.getElementById('cameraPlaceholder');
    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" }
        });
        if (video) {
            video.srcObject = webcamStream;
            video.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
        }
        document.getElementById('btnStartCam').style.display = 'none';
        document.getElementById('btnStopCam').style.display = 'inline-flex';
        showToast("Webcam active. Point at plant foliage.", "success");
    } catch (err) {
        showToast(`Camera error: ${err.message}`, "error");
    }
}

function stopWebcam() {
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    const video = document.getElementById('webcamVideo');
    const placeholder = document.getElementById('cameraPlaceholder');
    if (video) video.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
    document.getElementById('btnStartCam').style.display = 'inline-flex';
    document.getElementById('btnStopCam').style.display = 'none';
}

function captureAndDiagnose() {
    const video = document.getElementById('webcamVideo');
    if (!webcamStream || !video || video.style.display === 'none') {
        showToast("Please start camera or select a sample image first", "warn");
        return;
    }

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
            startWebcam().then(() => startAutoScanInterval());
        } else {
            startAutoScanInterval();
        }
    } else {
        if (autoScanInterval) {
            clearInterval(autoScanInterval);
            autoScanInterval = null;
        }
        showToast("Auto-scan stopped", "info");
    }
}

function startAutoScanInterval() {
    if (autoScanInterval) clearInterval(autoScanInterval);
    showToast("Auto-Scan Active (Every 25s)", "info");
    captureAndDiagnose();
    autoScanInterval = setInterval(() => captureAndDiagnose(), 25000);
}

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
            btn.addEventListener('click', () => runDiagnosisOnImage(sample.image));
            container.appendChild(btn);
        });
    } catch (e) {}
}

async function runDiagnosisOnImage(base64Image, trackPlant = false) {
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

            // Re-fetch 3D twin with newly mapped leaf pathology
            const twinRes = await fetch('/api/plant/twin');
            if (twinRes.ok) {
                const twinState = await twinRes.json();
                if (digitalTwin) digitalTwin.rebuildPlantModel(twinState);
            }

            showToast(`Diagnosis: ${diagnosis.diagnosis_name}`, 'success');
        } else {
            showToast(`Diagnosis failed: ${diagnosis.detail || 'Error'}`, 'error');
        }
    } catch (e) {
        showToast(`Request error: ${e.message}`, 'error');
    } finally {
        if (scanLoader) scanLoader.style.display = 'none';
    }
}

function renderDiagnosticReport(d) {
    document.getElementById('diagImgOriginal').src = d.original_image;
    document.getElementById('diagImgAnnotated').src = d.annotated_image;

    document.getElementById('diagName').textContent = d.diagnosis_name;
    document.getElementById('diagPathogen').textContent = d.pathogen_type;

    const severityEl = document.getElementById('diagSeverity');
    severityEl.textContent = d.severity;
    severityEl.className = `severity-badge severity-${d.severity.toLowerCase()}`;

    const scoreEl = document.getElementById('diagHealthScore');
    scoreEl.textContent = `${d.health_score}/100`;
    scoreEl.style.color = d.health_score > 80 ? '#10b981' : (d.health_score > 50 ? '#f59e0b' : '#ef4444');

    document.getElementById('metricDamagePct').textContent = `${d.damage_percentage}%`;
    document.getElementById('metricNecroticPct').textContent = `${d.metrics?.necrotic_percentage || 0}%`;
    document.getElementById('metricChlorosisPct').textContent = `${d.metrics?.chlorosis_percentage || 0}%`;
    document.getElementById('metricMildewPct').textContent = `${d.metrics?.mildew_percentage || 0}%`;

    document.getElementById('diagSymptoms').textContent = d.primary_symptoms;

    const act = d.farmer_action_plan || {};
    document.getElementById('planImmediate').textContent = act.immediate_action || 'None';
    document.getElementById('planOrganic').textContent = act.organic_treatment || 'None';
    document.getElementById('planChemical').textContent = act.chemical_treatment || 'None';

    const geminiBox = document.getElementById('geminiBox');
    const geminiText = document.getElementById('geminiText');
    if (d.gemini_insights) {
        geminiBox.style.display = 'block';
        geminiText.textContent = d.gemini_insights;
    } else {
        geminiBox.style.display = 'none';
    }

    if (d.severity === 'CRITICAL') playAlertTone();
}

// --- Audio Tone & Notifications ---
function playAlertTone() {
    try {
        if (!audioContextInstance) {
            audioContextInstance = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContextInstance.state === 'suspended') {
            audioContextInstance.resume();
        }
        const osc = audioContextInstance.createOscillator();
        const gain = audioContextInstance.createGain();
        osc.connect(gain);
        gain.connect(audioContextInstance.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, audioContextInstance.currentTime);
        osc.frequency.setValueAtTime(880.00, audioContextInstance.currentTime + 0.15);
        gain.gain.setValueAtTime(0.12, audioContextInstance.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContextInstance.currentTime + 0.35);
        osc.start();
        osc.stop(audioContextInstance.currentTime + 0.35);
    } catch (e) {}
}

function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 20);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 350);
    }, 3600);
}
