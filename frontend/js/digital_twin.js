/**
 * AgriTwin Pro - Biophysical 3D Plant Digital Twin Engine (Three.js WebGL)
 * 
 * Features:
 *  - Dynamic Procedural Morphogenesis: Generates stems, branches, and leaves according to
 *    phenological stages (seedling -> vegetative -> flowering -> fruiting).
 *  - Per-Leaf Biological State: Individual leaf addressing with independent health coloring,
 *    localized lesions (chlorosis, necrosis, mildew), and phyllotaxis angles.
 *  - Biophysical VPD Transpiration & Wilting Physics: Real-time turgor pressure droop simulation.
 *  - Reproductive Organs: Procedural flowers and fruits emerge at maturity.
 *  - Interactive 3D Raycasting: Hover and click individual leaves to view local leaf metrics.
 *  - Virtual-to-Physical Actuation: Click the 3D grow luminaire to toggle physical hardware!
 */

class PlantDigitalTwin {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // 3D Groups
        this.plantGroup = null;
        this.stemMesh = null;
        this.canopyGroup = null;
        this.leafMeshes = [];      // Array of individual { id, mesh, pivot, material, data, baseTilt }
        this.flowerMeshes = [];
        this.fruitMeshes = [];

        // Lights & Environment
        this.ambientLight = null;
        this.sunLight = null;
        this.growLampGroup = null;
        this.growLampBulb = null;
        this.growLightSpot = null;
        this.growLightPoint = null;
        this.soilMesh = null;
        this.statusRing = null;
        this.particles = null;

        // Biological State
        this.currentWiltFactor = 0.0;
        this.targetWiltFactor = 0.0;
        this.currentStemScaleY = 1.0;
        this.targetStemScaleY = 1.0;
        this.soilMoistureColor = new THREE.Color(0x3d2714);
        this.isWireframe = false;
        this.hoveredLeaf = null;

        // Actuator callback
        this.onActuatorToggle = null;

        this.init();
    }

    init() {
        if (!this.container) return;

        const width = this.container.clientWidth;
        const height = this.container.clientHeight || 460;

        // 1. Scene & Camera
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0f16);
        this.scene.fog = new THREE.FogExp2(0x0a0f16, 0.032);

        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        this.camera.position.set(0, 4.8, 8.2);

        // 2. Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // 3. OrbitControls
        if (typeof THREE.OrbitControls !== 'undefined') {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.maxPolarAngle = Math.PI / 2 + 0.02; // Restrict camera below floor
            this.controls.minDistance = 2.5;
            this.controls.maxDistance = 14;
            this.controls.target.set(0, 2.3, 0);
        }

        // 4. Lights & Scene Setup
        this.setupLights();
        this.setupEnvironment();
        this.buildGrowLamp();
        this.setupParticleSystem();

        // 5. Initial Plant Build
        this.rebuildPlantModel({
            stage: "vegetative",
            stem_height_cm: 18.0,
            stem_scale_y: 1.0,
            leaf_count: 8,
            leaves: this.generateInitialLeaves(8),
            has_flowers: false,
            has_fruit: false,
            fruit_count: 0
        });

        // 6. Event Listeners
        this.renderer.domElement.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.renderer.domElement.addEventListener('click', (e) => this.onSceneClick(e));
        window.addEventListener('resize', () => this.onResize());

        // 7. Start Render Loop
        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    generateInitialLeaves(count) {
        const leaves = [];
        for (let i = 0; i < count; i++) {
            leaves.append ? null : leaves.push({
                id: i,
                tier: i < count * 0.3 ? "lower" : (i < count * 0.7 ? "mid" : "upper"),
                disease: "healthy",
                health: 98,
                base_angle_rad: i * 2.39996,
                elevation_pct: (i + 1) / (count + 1)
            });
        }
        return leaves;
    }

    setupLights() {
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
        this.scene.add(this.ambientLight);

        this.sunLight = new THREE.DirectionalLight(0xfffaed, 0.85);
        this.sunLight.position.set(5, 12, 7);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 1024;
        this.sunLight.shadow.mapSize.height = 1024;
        this.sunLight.shadow.bias = -0.001;
        this.scene.add(this.sunLight);

        const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.25);
        fillLight.position.set(-6, 4, -4);
        this.scene.add(fillLight);
    }

    setupEnvironment() {
        // Pedestal
        const floorGeo = new THREE.CylinderGeometry(4.2, 4.5, 0.35, 48);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85, metalness: 0.15 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.position.y = -0.18;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Digital Grid
        const grid = new THREE.GridHelper(7.5, 15, 0x10b981, 0x1e293b);
        grid.position.y = 0.01;
        this.scene.add(grid);

        // Status Halo Ring
        const ringGeo = new THREE.RingGeometry(1.5, 1.65, 48);
        ringGeo.rotateX(-Math.PI / 2);
        this.statusRingMat = new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
        this.statusRing = new THREE.Mesh(ringGeo, this.statusRingMat);
        this.statusRing.position.y = 0.02;
        this.scene.add(this.statusRing);

        // Pot Base
        this.plantGroup = new THREE.Group();
        const potGeo = new THREE.CylinderGeometry(1.25, 0.9, 1.7, 32);
        const potMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.45, metalness: 0.25 });
        const pot = new THREE.Mesh(potGeo, potMat);
        pot.position.y = 0.85;
        pot.castShadow = true;
        pot.receiveShadow = true;
        pot.userData = { type: "pot", label: "Smart Pot (Soil Reservoir)" };
        this.plantGroup.add(pot);

        // Soil
        const soilGeo = new THREE.CylinderGeometry(1.18, 1.18, 0.08, 32);
        this.soilMat = new THREE.MeshStandardMaterial({ color: 0x3d2714, roughness: 0.95 });
        this.soilMesh = new THREE.Mesh(soilGeo, this.soilMat);
        this.soilMesh.position.y = 1.68;
        this.soilMesh.userData = { type: "soil", label: "Root Zone Soil" };
        this.plantGroup.add(this.soilMesh);

        this.canopyGroup = new THREE.Group();
        this.plantGroup.add(this.canopyGroup);
        this.scene.add(this.plantGroup);
    }

    buildGrowLamp() {
        this.growLampGroup = new THREE.Group();
        this.growLampGroup.position.set(0, 5.9, 0);

        const rodGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.2, 12);
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.3 });
        const rod = new THREE.Mesh(rodGeo, metalMat);
        rod.position.y = 1.1;
        this.growLampGroup.add(rod);

        const hoodGeo = new THREE.CylinderGeometry(0.7, 1.35, 0.35, 24, 1, true);
        const hoodMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
        const hood = new THREE.Mesh(hoodGeo, hoodMat);
        hood.userData = { type: "luminaire", label: "Grow Luminaire (Click to Toggle)" };
        this.growLampGroup.add(hood);

        const discGeo = new THREE.CircleGeometry(0.85, 24);
        discGeo.rotateX(Math.PI / 2);
        this.growLampMat = new THREE.MeshBasicMaterial({ color: 0xffea79 });
        this.growLampBulb = new THREE.Mesh(discGeo, this.growLampMat);
        this.growLampBulb.position.y = 0.02;
        this.growLampBulb.userData = { type: "luminaire", label: "Grow Luminaire (Click to Toggle)" };
        this.growLampGroup.add(this.growLampBulb);

        this.growLightSpot = new THREE.SpotLight(0xffecd2, 2.8, 8, Math.PI / 3.2, 0.45, 1);
        this.growLightSpot.position.set(0, 0, 0);
        this.growLightSpot.target.position.set(0, 2.2, 0);
        this.growLightSpot.castShadow = true;
        this.growLampGroup.add(this.growLightSpot);
        this.growLampGroup.add(this.growLightSpot.target);

        this.growLightPoint = new THREE.PointLight(0xf59e0b, 1.2, 4);
        this.growLightPoint.position.set(0, -0.2, 0);
        this.growLampGroup.add(this.growLightPoint);

        this.scene.add(this.growLampGroup);
    }

    setupParticleSystem() {
        const count = 80;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const speeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 3.2;
            positions[i * 3 + 1] = 1.7 + Math.random() * 3.2;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 3.2;
            speeds[i] = 0.006 + Math.random() * 0.012;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.particleSpeeds = speeds;

        const pMaterial = new THREE.PointsMaterial({
            color: 0x38bdf8,
            size: 0.065,
            transparent: true,
            opacity: 0.45,
            blending: THREE.AdditiveBlending
        });

        this.particles = new THREE.Points(geometry, pMaterial);
        this.scene.add(this.particles);
    }

    /**
     * Morphogenetic Rebuilder: Dynamically constructs the plant according to stage & leaf descriptors
     */
    rebuildPlantModel(state) {
        if (!this.canopyGroup) return;

        // Clear previous canopy meshes
        while (this.canopyGroup.children.length > 0) {
            const obj = this.canopyGroup.children[0];
            this.canopyGroup.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        }
        this.leafMeshes = [];
        this.flowerMeshes = [];
        this.fruitMeshes = [];

        const stemHeight = Math.max(1.5, Math.min(3.8, (state.stem_height_cm || 18.0) * 0.1));
        this.targetStemScaleY = state.stem_scale_y || 1.0;

        // Main Stem Curve
        const stemCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 1.68, 0),
            new THREE.Vector3(0.06, 1.68 + stemHeight * 0.3, -0.04),
            new THREE.Vector3(-0.05, 1.68 + stemHeight * 0.65, 0.05),
            new THREE.Vector3(0.03, 1.68 + stemHeight * 0.9, -0.02),
            new THREE.Vector3(0, 1.68 + stemHeight, 0)
        ]);

        const stemGeo = new THREE.TubeGeometry(stemCurve, 32, 0.08, 12, false);
        this.stemMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.65 });
        this.stemMesh = new THREE.Mesh(stemGeo, this.stemMat);
        this.stemMesh.castShadow = true;
        this.stemMesh.userData = { type: "stem", label: `Stem (Height: ${state.stem_height_cm || 18} cm)` };
        this.canopyGroup.add(this.stemMesh);

        // Procedural Leaf Geometry Generator (Bezier Heart/Blade)
        const leafShape = new THREE.Shape();
        leafShape.moveTo(0, 0);
        leafShape.bezierCurveTo(0.38, 0.45, 0.58, 1.15, 0, 2.1);
        leafShape.bezierCurveTo(-0.58, 1.15, -0.38, 0.45, 0, 0);

        const leafExtrudeSettings = { depth: 0.018, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.012, bevelThickness: 0.01 };
        const baseLeafGeo = new THREE.ExtrudeGeometry(leafShape, leafExtrudeSettings);
        baseLeafGeo.center();
        baseLeafGeo.translate(0, 0.98, 0);

        // Construct Individual Foliage Leaves
        const leavesData = state.leaves || [];
        leavesData.forEach((lData) => {
            const pivot = new THREE.Group();
            const yPos = 1.75 + (stemHeight * 0.88) * (lData.elevation_pct || 0.5);
            pivot.position.set(0, yPos, 0);
            pivot.rotation.y = lData.base_angle_rad || (lData.id * 2.4);

            // Petiole Branchlet
            const petioleGeo = new THREE.CylinderGeometry(0.022, 0.035, 0.42, 8);
            petioleGeo.rotateX(Math.PI / 2);
            petioleGeo.translate(0, 0, 0.21);
            const petiole = new THREE.Mesh(petioleGeo, this.stemMat);
            pivot.add(petiole);

            // Determine Individual Leaf Color based on pathology
            let leafHex = 0x10b981; // Healthy Emerald
            if (lData.disease === "chlorosis") leafHex = 0xeab308; // Yellow
            else if (lData.disease === "necrosis") leafHex = 0x78350f; // Brown necrotic
            else if (lData.disease === "mildew") leafHex = 0x94a3b8; // Whitish mycelium

            const leafMat = new THREE.MeshStandardMaterial({
                color: leafHex,
                roughness: 0.45,
                metalness: 0.05,
                side: THREE.DoubleSide
            });

            const scale = lData.tier === "lower" ? 0.92 : (lData.tier === "mid" ? 0.84 : 0.68);
            const baseTilt = lData.tier === "lower" ? 1.18 : (lData.tier === "mid" ? 0.95 : 0.65);

            const leafMesh = new THREE.Mesh(baseLeafGeo.clone(), leafMat);
            leafMesh.position.set(0, 0, 0.4);
            leafMesh.rotation.x = baseTilt;
            leafMesh.scale.set(scale, scale, scale);
            leafMesh.castShadow = true;
            leafMesh.receiveShadow = true;
            leafMesh.userData = {
                type: "leaf",
                id: lData.id,
                tier: lData.tier,
                disease: lData.disease,
                health: lData.health,
                label: `Leaf #${lData.id + 1} (${lData.tier.toUpperCase()}) | Health: ${lData.health}% | Status: ${lData.disease.toUpperCase()}`
            };

            pivot.add(leafMesh);
            this.canopyGroup.add(pivot);

            this.leafMeshes.push({
                id: lData.id,
                mesh: leafMesh,
                pivot: pivot,
                material: leafMat,
                baseTilt: baseTilt,
                data: lData
            });
        });

        // Add Flowers if Stage >= Flowering
        if (state.has_flowers) {
            this.addFlowerBlossoms(stemHeight);
        }

        // Add Fruits if Stage >= Fruiting
        if (state.has_fruit && state.fruit_count > 0) {
            this.addFruitBodies(stemHeight, state.fruit_count);
        }
    }

    addFlowerBlossoms(stemHeight) {
        const flowerGeo = new THREE.DodecahedronGeometry(0.12, 1);
        const flowerMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xca8a04, emissiveIntensity: 0.3 });
        for (let i = 0; i < 3; i++) {
            const flower = new THREE.Mesh(flowerGeo, flowerMat);
            flower.position.set(
                (Math.random() - 0.5) * 0.4,
                1.7 + stemHeight * (0.75 + i * 0.08),
                (Math.random() - 0.5) * 0.4
            );
            flower.userData = { type: "flower", label: "Blossom Flower Bud" };
            this.canopyGroup.add(flower);
            this.flowerMeshes.push(flower);
        }
    }

    addFruitBodies(stemHeight, count) {
        const fruitGeo = new THREE.SphereGeometry(0.2, 16, 16);
        const fruitMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3, metalness: 0.1 });
        for (let i = 0; i < count; i++) {
            const fruit = new THREE.Mesh(fruitGeo, fruitMat);
            fruit.position.set(
                (i % 2 === 0 ? 0.35 : -0.35) * (0.8 + Math.random() * 0.3),
                1.7 + stemHeight * (0.45 + i * 0.12),
                (i % 2 === 0 ? 0.3 : -0.3)
            );
            fruit.castShadow = true;
            fruit.userData = { type: "fruit", label: `Specimen Fruit #${i + 1} (Ripening)` };
            this.canopyGroup.add(fruit);
            this.fruitMeshes.push(fruit);
        }
    }

    /**
     * Receives Live IoT Telemetry + Biophysical Growth Engine Data
     */
    updateState(telemetry, growth) {
        if (!telemetry) return;

        const { light_value, led_state, threshold, humidity } = telemetry;
        const isLedActive = led_state !== undefined ? led_state : (light_value < (threshold || 700));

        // Grow Luminaire Sync
        if (isLedActive) {
            this.growLightSpot.intensity = 2.8;
            this.growLightPoint.intensity = 1.2;
            this.growLampMat.color.setHex(0xffea79);
        } else {
            this.growLightSpot.intensity = 0.0;
            this.growLightPoint.intensity = 0.0;
            this.growLampMat.color.setHex(0x1e293b);
        }

        // Sunlight sync with LDR
        const normLight = Math.max(0.1, Math.min(1.2, light_value / 750.0));
        this.sunLight.intensity = normLight * 0.9;
        this.ambientLight.intensity = 0.25 + normLight * 0.35;

        // Wilting / Turgor sync
        if (growth && growth.turgor_wilt !== undefined) {
            this.targetWiltFactor = growth.turgor_wilt;
        }

        // Particle opacity
        if (this.particles) {
            this.particles.material.opacity = Math.max(0.1, Math.min(0.7, (humidity - 30) / 70.0));
        }

        // Check if morphogenetic reconstruction is needed
        if (growth && growth.twin_3d_state) {
            const twin = growth.twin_3d_state;
            if (twin.leaf_count !== this.leafMeshes.length || twin.has_flowers !== (this.flowerMeshes.length > 0)) {
                this.rebuildPlantModel(twin);
            } else {
                // Update per-leaf pathology colors dynamically
                (twin.leaves || []).forEach(lData => {
                    const leafObj = this.leafMeshes.find(m => m.id === lData.id);
                    if (leafObj) {
                        let hex = 0x10b981;
                        if (lData.disease === "chlorosis") hex = 0xeab308;
                        else if (lData.disease === "necrosis") hex = 0x78350f;
                        else if (lData.disease === "mildew") hex = 0x94a3b8;
                        leafObj.material.color.setHex(hex);
                        leafObj.data = lData;
                        leafObj.mesh.userData.label = `Leaf #${lData.id + 1} (${lData.tier.toUpperCase()}) | Health: ${lData.health}% | Status: ${lData.disease.toUpperCase()}`;
                    }
                });
            }
        }
    }

    onMouseMove(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        const tooltip = document.getElementById('twin3dTooltip');
        let found = null;

        for (let hit of intersects) {
            if (hit.object.userData && hit.object.userData.label) {
                found = hit.object;
                break;
            }
        }

        if (found && tooltip) {
            tooltip.textContent = found.userData.label;
            tooltip.style.left = `${event.clientX + 14}px`;
            tooltip.style.top = `${event.clientY - 28}px`;
            tooltip.style.display = 'block';
            this.renderer.domElement.style.cursor = 'pointer';
        } else if (tooltip) {
            tooltip.style.display = 'none';
            this.renderer.domElement.style.cursor = 'default';
        }
    }

    onSceneClick(event) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        for (let hit of intersects) {
            const data = hit.object.userData;
            if (data && data.type === "luminaire") {
                // Virtual-to-Physical actuation trigger
                if (typeof this.onActuatorToggle === 'function') {
                    this.onActuatorToggle("led");
                }
                break;
            } else if (data && data.type === "leaf") {
                showToast(`Inspecting ${data.label}`, "info");
                break;
            }
        }
    }

    toggleWireframe() {
        this.isWireframe = !this.isWireframe;
        this.leafMeshes.forEach(l => l.material.wireframe = this.isWireframe);
        if (this.stemMat) this.stemMat.wireframe = this.isWireframe;
        return this.isWireframe;
    }

    animate() {
        requestAnimationFrame(this.animate);

        // Smooth wilting easing
        this.currentWiltFactor += (this.targetWiltFactor - this.currentWiltFactor) * 0.04;
        this.currentStemScaleY += (this.targetStemScaleY - this.currentStemScaleY) * 0.04;

        if (this.canopyGroup) {
            this.canopyGroup.scale.y = this.currentStemScaleY;
        }

        // Apply realistic turgor droop & gentle diurnal wind
        const time = Date.now() * 0.0015;
        this.leafMeshes.forEach((l, idx) => {
            const wind = Math.sin(time + idx * 0.7) * 0.02;
            const droop = this.currentWiltFactor * (l.data.tier === "lower" ? 0.75 : 0.55);
            l.mesh.rotation.x = l.baseTilt + droop + wind;
        });

        // Status ring pulse
        if (this.statusRing) {
            const pulse = 1.0 + Math.sin(time * 2.5) * 0.06;
            this.statusRing.scale.set(pulse, pulse, pulse);
        }

        // Floating particles
        if (this.particles) {
            const positions = this.particles.geometry.attributes.position.array;
            for (let i = 0; i < this.particleSpeeds.length; i++) {
                positions[i * 3 + 1] += this.particleSpeeds[i];
                if (positions[i * 3 + 1] > 5.2) positions[i * 3 + 1] = 1.7;
            }
            this.particles.geometry.attributes.position.needsUpdate = true;
        }

        if (this.controls) this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        if (!this.container || !this.renderer || !this.camera) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight || 460;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
}

window.PlantDigitalTwin = PlantDigitalTwin;
