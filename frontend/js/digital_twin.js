/**
 * Plant Digital Twin - Three.js 3D Environmental & Biological Simulation
 * Dynamically reacts to:
 *  - LDR Light sensor (Scene ambient illumination)
 *  - LED Grow Light status (Overhead LED lamp ON/OFF & beam)
 *  - Humidity & Temperature (Leaf turgor pressure / wilting angle)
 *  - Vision Disease Diagnosis (Leaf color shifts, necrotic spotting, warning ring)
 */

class PlantDigitalTwin {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;

        // Model components
        this.plantGroup = null;
        this.canopyGroup = null;
        this.leaves = [];
        this.leafMaterials = [];
        this.growLampBulb = null;
        this.growLightSpot = null;
        this.growLightPoint = null;
        this.sunLight = null;
        this.ambientLight = null;
        this.statusRing = null;
        this.particles = null;

        // Biological state
        this.targetWiltFactor = 0.0;   // 0 = upright & healthy, 1 = fully wilted
        this.currentWiltFactor = 0.0;
        this.targetCanopyScale = new THREE.Vector3(1, 1, 1);
        this.currentCanopyScale = new THREE.Vector3(1, 1, 1);
        this.targetLeafColor = new THREE.Color(0x27ae60);
        this.currentLeafColor = new THREE.Color(0x27ae60);
        this.isWireframe = false;

        this.init();
    }

    init() {
        if (!this.container) return;

        const width = this.container.clientWidth;
        const height = this.container.clientHeight || 450;

        // 1. Scene & Camera
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0e171e);
        this.scene.fog = new THREE.FogExp2(0x0e171e, 0.035);

        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        this.camera.position.set(0, 5, 8.5);

        // 2. Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // 3. Orbit Controls
        if (typeof THREE.OrbitControls !== 'undefined') {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.maxPolarAngle = Math.PI / 2 + 0.05; // Don't go below floor
            this.controls.minDistance = 3;
            this.controls.maxDistance = 15;
            this.controls.target.set(0, 2.5, 0);
        }

        // 4. Lights
        this.setupLights();

        // 5. Environment & Floor
        this.setupEnvironment();

        // 6. 3D Plant Model
        this.buildPlantModel();

        // 7. Overhead Grow Lamp
        this.buildGrowLamp();

        // 8. Atmospheric Particles (Moisture / Mist)
        this.setupParticleSystem();

        // 9. Resize Listener
        window.addEventListener('resize', () => this.onResize());

        // 10. Start Animation Loop
        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    setupLights() {
        // Soft Ambient Light (modulated by LDR)
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(this.ambientLight);

        // Natural Sunlight / Day Light
        this.sunLight = new THREE.DirectionalLight(0xfffaed, 0.8);
        this.sunLight.position.set(5, 12, 7);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 1024;
        this.sunLight.shadow.mapSize.height = 1024;
        this.sunLight.shadow.bias = -0.001;
        this.scene.add(this.sunLight);

        // Fill Light
        const fillLight = new THREE.DirectionalLight(0x4a7590, 0.3);
        fillLight.position.set(-5, 4, -4);
        this.scene.add(fillLight);
    }

    setupEnvironment() {
        // Circular Pedestal / Floor
        const floorGeo = new THREE.CylinderGeometry(4.5, 4.8, 0.4, 48);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x16222f,
            roughness: 0.85,
            metalness: 0.15
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.position.y = -0.2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Digital Grid Lines on floor
        const grid = new THREE.GridHelper(8, 16, 0x2ecc71, 0x1c313a);
        grid.position.y = 0.01;
        this.scene.add(grid);

        // Glowing Telemetry Status Ring at the base
        const ringGeo = new THREE.RingGeometry(1.6, 1.75, 48);
        ringGeo.rotateX(-Math.PI / 2);
        this.statusRingMat = new THREE.MeshBasicMaterial({
            color: 0x2ecc71,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.6
        });
        this.statusRing = new THREE.Mesh(ringGeo, this.statusRingMat);
        this.statusRing.position.y = 0.02;
        this.scene.add(this.statusRing);
    }

    buildPlantModel() {
        this.plantGroup = new THREE.Group();

        // 1. Ceramic Smart Pot
        const potGeo = new THREE.CylinderGeometry(1.3, 0.95, 1.8, 32);
        const potMat = new THREE.MeshStandardMaterial({
            color: 0x2c3e50,
            roughness: 0.4,
            metalness: 0.2
        });
        const pot = new THREE.Mesh(potGeo, potMat);
        pot.position.y = 0.9;
        pot.castShadow = true;
        pot.receiveShadow = true;
        this.plantGroup.add(pot);

        // Pot Rim
        const rimGeo = new THREE.TorusGeometry(1.32, 0.08, 16, 32);
        rimGeo.rotateX(Math.PI / 2);
        const rim = new THREE.Mesh(rimGeo, potMat);
        rim.position.y = 1.8;
        this.plantGroup.add(rim);

        // Soil
        const soilGeo = new THREE.CylinderGeometry(1.22, 1.22, 0.1, 32);
        const soilMat = new THREE.MeshStandardMaterial({
            color: 0x3d2714,
            roughness: 0.95
        });
        const soil = new THREE.Mesh(soilGeo, soilMat);
        soil.position.y = 1.75;
        this.plantGroup.add(soil);

        this.canopyGroup = new THREE.Group();
        this.plantGroup.add(this.canopyGroup);

        // 2. Main Stem
        const stemCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 1.75, 0),
            new THREE.Vector3(0.08, 2.5, -0.05),
            new THREE.Vector3(-0.05, 3.4, 0.08),
            new THREE.Vector3(0.04, 4.3, -0.02),
            new THREE.Vector3(0, 4.9, 0)
        ]);

        const stemGeo = new THREE.TubeGeometry(stemCurve, 32, 0.09, 12, false);
        this.stemMat = new THREE.MeshStandardMaterial({
            color: 0x2d8a4e,
            roughness: 0.6
        });
        const stemMesh = new THREE.Mesh(stemGeo, this.stemMat);
        stemMesh.castShadow = true;
        this.canopyGroup.add(stemMesh);

        // 3. Foliage Leaves
        // Custom Leaf Geometry shape
        const leafShape = new THREE.Shape();
        leafShape.moveTo(0, 0);
        leafShape.bezierCurveTo(0.35, 0.4, 0.55, 1.1, 0, 2.0); // Right side curve
        leafShape.bezierCurveTo(-0.55, 1.1, -0.35, 0.4, 0, 0); // Left side curve

        const leafExtrudeSettings = {
            depth: 0.02,
            bevelEnabled: true,
            bevelSegments: 2,
            steps: 1,
            bevelSize: 0.015,
            bevelThickness: 0.01
        };

        const leafGeo = new THREE.ExtrudeGeometry(leafShape, leafExtrudeSettings);
        // Center rotation pivot at leaf base
        leafGeo.center();
        leafGeo.translate(0, 0.95, 0);

        // Tiered Leaf Arrangement around the stem
        const leafConfigs = [
            // Lower tier (large leaves)
            { height: 2.3, rotY: 0, scale: 0.95, baseTilt: 1.1 },
            { height: 2.4, rotY: Math.PI * 0.66, scale: 0.9, baseTilt: 1.15 },
            { height: 2.45, rotY: Math.PI * 1.33, scale: 0.92, baseTilt: 1.12 },

            // Middle tier (medium vibrant leaves)
            { height: 3.1, rotY: Math.PI * 0.33, scale: 0.85, baseTilt: 0.95 },
            { height: 3.2, rotY: Math.PI, scale: 0.88, baseTilt: 0.92 },
            { height: 3.3, rotY: Math.PI * 1.66, scale: 0.82, baseTilt: 0.98 },

            // Upper tier (young growth)
            { height: 3.9, rotY: Math.PI * 0.15, scale: 0.72, baseTilt: 0.75 },
            { height: 4.0, rotY: Math.PI * 0.85, scale: 0.75, baseTilt: 0.72 },
            { height: 4.1, rotY: Math.PI * 1.45, scale: 0.7, baseTilt: 0.78 },

            // Apical Shoot / Crown
            { height: 4.7, rotY: Math.PI * 0.4, scale: 0.52, baseTilt: 0.45 },
            { height: 4.8, rotY: Math.PI * 1.1, scale: 0.5, baseTilt: 0.42 }
        ];

        leafConfigs.forEach((cfg) => {
            const leafMat = new THREE.MeshStandardMaterial({
                color: 0x27ae60,
                roughness: 0.45,
                metalness: 0.05,
                side: THREE.DoubleSide
            });
            this.leafMaterials.push(leafMat);

            // Pivot container for smooth wilting rotation
            const leafPivot = new THREE.Group();
            leafPivot.position.set(0, cfg.height, 0);
            leafPivot.rotation.y = cfg.rotY;

            // Branch stemlet
            const petioleGeo = new THREE.CylinderGeometry(0.025, 0.04, 0.45, 8);
            petioleGeo.rotateX(Math.PI / 2);
            petioleGeo.translate(0, 0, 0.22);
            const petiole = new THREE.Mesh(petioleGeo, this.stemMat);
            leafPivot.add(petiole);

            // Actual Leaf Mesh
            const leafMesh = new THREE.Mesh(leafGeo, leafMat);
            leafMesh.position.set(0, 0, 0.42);
            leafMesh.rotation.x = cfg.baseTilt; // Natural arch outward
            leafMesh.scale.set(cfg.scale, cfg.scale, cfg.scale);
            leafMesh.castShadow = true;
            leafMesh.receiveShadow = true;

            leafPivot.add(leafMesh);
            this.canopyGroup.add(leafPivot);

            this.leaves.push({
                pivot: leafPivot,
                mesh: leafMesh,
                baseTilt: cfg.baseTilt,
                scale: cfg.scale
            });
        });

        this.scene.add(this.plantGroup);
    }

    buildGrowLamp() {
        const lampGroup = new THREE.Group();
        lampGroup.position.set(0, 6.2, 0);

        // Mounting Fixture & Rod
        const rodGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.5, 12);
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x7f8c8d, metalness: 0.8, roughness: 0.3 });
        const rod = new THREE.Mesh(rodGeo, metalMat);
        rod.position.y = 1.25;
        lampGroup.add(rod);

        // LED Reflector Hood
        const hoodGeo = new THREE.CylinderGeometry(0.75, 1.4, 0.4, 24, 1, true);
        const hoodMat = new THREE.MeshStandardMaterial({ color: 0x222f3e, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
        const hood = new THREE.Mesh(hoodGeo, hoodMat);
        lampGroup.add(hood);

        // LED Emitter Disc / Bulb
        const discGeo = new THREE.CircleGeometry(0.9, 24);
        discGeo.rotateX(Math.PI / 2);
        this.growLampMat = new THREE.MeshBasicMaterial({ color: 0xffeeaa });
        this.growLampBulb = new THREE.Mesh(discGeo, this.growLampMat);
        this.growLampBulb.position.y = 0.02;
        lampGroup.add(this.growLampBulb);

        // SpotLight pointing straight down on plant
        this.growLightSpot = new THREE.SpotLight(0xffecd2, 2.5, 8, Math.PI / 3.5, 0.4, 1);
        this.growLightSpot.position.set(0, 0, 0);
        this.growLightSpot.target.position.set(0, 2.5, 0);
        this.growLightSpot.castShadow = true;
        lampGroup.add(this.growLightSpot);
        lampGroup.add(this.growLightSpot.target);

        // PointLight for ambient glow
        this.growLightPoint = new THREE.PointLight(0xffb703, 1.0, 4);
        this.growLightPoint.position.set(0, -0.2, 0);
        lampGroup.add(this.growLightPoint);

        this.scene.add(lampGroup);
    }

    setupParticleSystem() {
        const particleCount = 70;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const speeds = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 3.5;
            positions[i * 3 + 1] = 1.8 + Math.random() * 3.5;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 3.5;
            speeds[i] = 0.005 + Math.random() * 0.01;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.particleSpeeds = speeds;

        const pMaterial = new THREE.PointsMaterial({
            color: 0x00f2fe,
            size: 0.06,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending
        });

        this.particles = new THREE.Points(geometry, pMaterial);
        this.scene.add(this.particles);
    }

    /**
     * Updates Digital Twin according to real-time telemetry from Arduino / IoT sensors
     */
    updateTelemetry(telemetry) {
        if (!telemetry) return;

        const { temperature, humidity, light_value, led_state, threshold } = telemetry;

        // 1. Grow Lamp State (Matches Arduino code: LED ON if light < THRESHOLD)
        const isLedActive = led_state !== undefined ? led_state : (light_value < (threshold || 700));

        if (isLedActive) {
            this.growLightSpot.intensity = 2.8;
            this.growLightPoint.intensity = 1.2;
            this.growLampMat.color.setHex(0xffea79); // Glowing warm/grow light
        } else {
            this.growLightSpot.intensity = 0.0;
            this.growLightPoint.intensity = 0.0;
            this.growLampMat.color.setHex(0x333333); // Switched off
        }

        // 2. Sunlight & Ambient light intensity (Driven by LDR sensor 0 - 1023)
        // High lightValue = bright daylight; Low lightValue = dark room / night
        const normLight = Math.max(0.1, Math.min(1.2, light_value / 750.0));
        this.sunLight.intensity = normLight * 0.9;
        this.ambientLight.intensity = 0.25 + normLight * 0.35;

        // 3. Wilting Calculation (Turgor Pressure)
        // Optimal humidity is 55-75%, temp 22-26°C.
        // Extreme low humidity (<40%) or high temp (>32°C) causes physical drooping.
        let wiltScore = 0.0;
        if (humidity < 45) {
            wiltScore += (45 - humidity) / 45.0 * 0.65;
        }
        if (temperature > 28) {
            wiltScore += (temperature - 28) / 15.0 * 0.45;
        }
        this.targetWiltFactor = Math.min(0.85, Math.max(0.0, wiltScore));

        // 4. Particle System density (Mist droplets visible if humid)
        if (this.particles) {
            this.particles.material.opacity = Math.max(0.1, Math.min(0.7, (humidity - 30) / 70.0));
        }
    }

    /**
     * Updates Digital Twin appearance based on Computer Vision Disease Detection
     */
    updateDiseaseState(diagnosis) {
        if (!diagnosis || !diagnosis.success) return;

        const { severity, diagnosis_name, damage_percentage, metrics } = diagnosis;

        // Determine target leaf pigmentation
        if (severity === "HEALTHY") {
            this.targetLeafColor.setHex(0x27ae60); // Vibrant green
            this.statusRingMat.color.setHex(0x2ecc71); // Green ring
            this.statusRingMat.opacity = 0.6;
        } else if (diagnosis_name.includes("Mildew")) {
            this.targetLeafColor.setHex(0x95a5a6); // Whitish/gray cast
            this.statusRingMat.color.setHex(0x00f2fe); // Cyan warning ring
            this.statusRingMat.opacity = 0.9;
        } else if (diagnosis_name.includes("Chlorosis")) {
            this.targetLeafColor.setHex(0xf1c40f); // Yellowish chlorosis
            this.statusRingMat.color.setHex(0xf39c12); // Yellow-orange ring
            this.statusRingMat.opacity = 0.9;
        } else {
            // Blight / Rust / Necrosis
            this.targetLeafColor.setHex(0x784212); // Brown necrotic tint
            this.statusRingMat.color.setHex(0xe74c3c); // Red emergency ring
            this.statusRingMat.opacity = 1.0;
        }

        // Additional wilt boost if severely diseased
        if (damage_percentage > 20) {
            this.targetWiltFactor = Math.min(0.9, this.targetWiltFactor + 0.35);
        }
    }

    updatePlantScan(scan) {
        if (!scan || scan.status === "no_plant" || !scan.twin_scale) return;
        this.targetCanopyScale.set(
            scan.twin_scale.x,
            scan.twin_scale.y,
            scan.twin_scale.z
        );
    }

    resetPlantScan() {
        this.targetCanopyScale.set(1, 1, 1);
    }

    toggleWireframe() {
        this.isWireframe = !this.isWireframe;
        this.leafMaterials.forEach(m => m.wireframe = this.isWireframe);
        if (this.stemMat) this.stemMat.wireframe = this.isWireframe;
        return this.isWireframe;
    }

    animate() {
        requestAnimationFrame(this.animate);

        // Smoothly interpolate wilting factor (easing)
        this.currentWiltFactor += (this.targetWiltFactor - this.currentWiltFactor) * 0.04;
        this.currentCanopyScale.lerp(this.targetCanopyScale, 0.04);
        if (this.canopyGroup) {
            this.canopyGroup.scale.copy(this.currentCanopyScale);
        }

        // Apply dynamic wilting arch & subtle wind breathing to leaves
        const time = Date.now() * 0.0015;
        this.leaves.forEach((l, idx) => {
            const wind = Math.sin(time + idx * 0.8) * 0.025;
            // When wilted, leaf arches downwards (increase rotation.x)
            l.mesh.rotation.x = l.baseTilt + (this.currentWiltFactor * 0.65) + wind;
        });

        // Smoothly interpolate leaf pigmentation
        this.currentLeafColor.lerp(this.targetLeafColor, 0.04);
        this.leafMaterials.forEach(mat => {
            mat.color.copy(this.currentLeafColor);
        });

        // Subtle gentle idle rotation of plant base
        if (this.plantGroup) {
            this.plantGroup.rotation.y = Math.sin(time * 0.25) * 0.05;
        }

        // Floating moisture particles
        if (this.particles) {
            const positions = this.particles.geometry.attributes.position.array;
            for (let i = 0; i < this.particleSpeeds.length; i++) {
                positions[i * 3 + 1] += this.particleSpeeds[i];
                // Reset particles to bottom once they float too high
                if (positions[i * 3 + 1] > 5.5) {
                    positions[i * 3 + 1] = 1.8;
                }
            }
            this.particles.geometry.attributes.position.needsUpdate = true;
        }

        // Pulsing status ring
        if (this.statusRing) {
            const pulse = 1.0 + Math.sin(time * 3) * 0.08;
            this.statusRing.scale.set(pulse, pulse, pulse);
        }

        if (this.controls) {
            this.controls.update();
        }

        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        if (!this.container || !this.renderer || !this.camera) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight || 450;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
}

window.PlantDigitalTwin = PlantDigitalTwin;
