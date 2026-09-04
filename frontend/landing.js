import * as THREE from "/vendor/three.module.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const revealNodes = document.querySelectorAll("[data-reveal]");
if (reducedMotion) {
  revealNodes.forEach((node) => node.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.18, rootMargin: "0px 0px -6% 0px" });
  revealNodes.forEach((node) => revealObserver.observe(node));
}

const canvas = document.querySelector("#synodScene");
const sceneZones = document.querySelectorAll(".scene-zone");
const palettes = {
  chamber: { primary: 0x9af6cf, secondary: 0xb8a9ff, depth: 0.16, spin: 0.16 },
  ledger: { primary: 0xf1cd86, secondary: 0x9af6cf, depth: 0.05, spin: 0.11 },
  council: { primary: 0xb8a9ff, secondary: 0x9af6cf, depth: 0.22, spin: 0.19 },
  voice: { primary: 0x9af6cf, secondary: 0xff9ecf, depth: 0.28, spin: 0.14 },
  artifact: { primary: 0xf1cd86, secondary: 0xb8a9ff, depth: 0.1, spin: 0.1 },
  enterprise: { primary: 0xb8a9ff, secondary: 0xf5f7ff, depth: 0.2, spin: 0.08 },
  journey: { primary: 0x9af6cf, secondary: 0xf1cd86, depth: 0.32, spin: 0.22 },
  language: { primary: 0xff9ecf, secondary: 0x9af6cf, depth: 0.18, spin: 0.12 },
  finale: { primary: 0x9af6cf, secondary: 0xb8a9ff, depth: 0.06, spin: 0.18 }
};

let activeScene = palettes.chamber;
let pointerX = 0.62;
let pointerY = 0.32;

if (!reducedMotion) {
  window.addEventListener("pointermove", (event) => {
    pointerX = event.clientX / Math.max(window.innerWidth, 1);
    pointerY = event.clientY / Math.max(window.innerHeight, 1);
  }, { passive: true });
}

const zoneObserver = new IntersectionObserver((entries) => {
  const visible = entries
    .filter((entry) => entry.isIntersecting)
    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  const key = visible.target.dataset.scene;
  if (key && palettes[key]) activeScene = palettes[key];
}, { threshold: [0.24, 0.42, 0.62], rootMargin: "-20% 0px -28% 0px" });
sceneZones.forEach((zone) => zoneObserver.observe(zone));

function createScene() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x070914, 8, 19);

  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 80);
  camera.position.set(0.6, 1.2, 8.4);

  const chamber = new THREE.Group();
  chamber.rotation.set(-0.14, -0.36, 0.02);
  scene.add(chamber);

  const ambient = new THREE.AmbientLight(0x8fa5ff, 0.72);
  const key = new THREE.DirectionalLight(0xf5f7ff, 1.55);
  key.position.set(-3.4, 4.6, 5.8);
  const rim = new THREE.PointLight(0x9af6cf, 2.2, 16);
  rim.position.set(3.8, -0.8, 3.8);
  scene.add(ambient, key, rim);

  const primary = new THREE.Color(activeScene.primary);
  const secondary = new THREE.Color(activeScene.secondary);

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x243052,
    roughness: 0.18,
    metalness: 0.06,
    transparent: true,
    opacity: 0.43,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: primary, transparent: true, opacity: 0.44 });
  const coreMaterial = new THREE.MeshPhysicalMaterial({
    color: primary,
    emissive: primary,
    emissiveIntensity: 0.28,
    roughness: 0.22,
    metalness: 0.12,
    transparent: true,
    opacity: 0.74
  });
  const nodeMaterial = new THREE.MeshBasicMaterial({ color: secondary, transparent: true, opacity: 0.78 });
  const railMaterial = new THREE.LineBasicMaterial({ color: 0xdce5ff, transparent: true, opacity: 0.16 });

  const panelGeometry = new THREE.BoxGeometry(3.3, 0.055, 1.56);
  const panelTransforms = [
    [-2.1, 0.8, -0.8, 0.18, 0.58, -0.1],
    [0.55, 0.18, 0.05, -0.08, -0.38, 0.06],
    [2.05, -0.62, 0.72, 0.16, 0.42, -0.04],
    [-0.6, -1.3, -0.38, -0.16, 0.16, 0.12]
  ];
  for (const transform of panelTransforms) {
    const panel = new THREE.Mesh(panelGeometry, glassMaterial);
    panel.position.set(transform[0], transform[1], transform[2]);
    panel.rotation.set(transform[3], transform[4], transform[5]);
    chamber.add(panel);

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(panelGeometry), edgeMaterial);
    edges.position.copy(panel.position);
    edges.rotation.copy(panel.rotation);
    chamber.add(edges);
  }

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), coreMaterial);
  core.position.set(0.1, -0.1, 0.32);
  chamber.add(core);

  const ringGroup = new THREE.Group();
  const ringGeometry = new THREE.TorusGeometry(2.8, 0.006, 12, 160);
  for (let index = 0; index < 4; index += 1) {
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
      color: index % 2 ? 0xb8a9ff : 0x9af6cf,
      transparent: true,
      opacity: 0.12 + index * 0.035
    }));
    ring.rotation.set(Math.PI / 2 + index * 0.18, index * 0.34, index * 0.21);
    ring.scale.setScalar(0.86 + index * 0.18);
    ringGroup.add(ring);
  }
  chamber.add(ringGroup);

  const nodeGeometry = new THREE.SphereGeometry(0.055, 18, 18);
  const nodePositions = [
    [-2.7, 1.3, -0.9], [-1.2, 1.7, -0.2], [1.7, 1.05, 0.4], [2.8, 0.04, 0.98],
    [-2.4, -0.6, -0.1], [-1.0, -1.68, 0.22], [1.1, -1.46, 0.7], [2.42, -0.9, -0.18]
  ];
  const nodeMeshes = [];
  for (const position of nodePositions) {
    const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
    node.position.set(position[0], position[1], position[2]);
    chamber.add(node);
    nodeMeshes.push(node);
  }

  const railPoints = [];
  for (const position of nodePositions) railPoints.push(new THREE.Vector3(position[0], position[1], position[2]));
  railPoints.push(new THREE.Vector3(nodePositions[0][0], nodePositions[0][1], nodePositions[0][2]));
  const rail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(railPoints), railMaterial);
  chamber.add(rail);

  const floorGroup = new THREE.Group();
  const floorMaterial = new THREE.LineBasicMaterial({ color: 0xf5f7ff, transparent: true, opacity: 0.08 });
  for (let i = -8; i <= 8; i += 1) {
    const horizontal = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-8, -2.2, i * 0.42), new THREE.Vector3(8, -2.2, i * 0.42)]),
      floorMaterial
    );
    const vertical = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i * 0.42, -2.2, -4), new THREE.Vector3(i * 0.42, -2.2, 4)]),
      floorMaterial
    );
    floorGroup.add(horizontal, vertical);
  }
  floorGroup.rotation.x = -0.34;
  scene.add(floorGroup);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize, { passive: true });
  resize();

  const clock = new THREE.Clock();
  const livePrimary = new THREE.Color(activeScene.primary);
  const liveSecondary = new THREE.Color(activeScene.secondary);
  let paintChecked = false;

  function markPaintedIfReady() {
    if (paintChecked) return;
    paintChecked = true;
    try {
      const gl = renderer.getContext();
      const samples = [
        [Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.5)],
        [Math.floor(canvas.width * 0.68), Math.floor(canvas.height * 0.5)],
        [Math.floor(canvas.width * 0.78), Math.floor(canvas.height * 0.38)],
        [Math.floor(canvas.width * 0.72), Math.floor(canvas.height * 0.64)]
      ];
      const pixel = new Uint8Array(4);
      const painted = samples.some(([x, y]) => {
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return pixel[0] + pixel[1] + pixel[2] + pixel[3] > 0;
      });
      document.documentElement.dataset.scenePainted = painted ? "true" : "false";
    } catch {
      document.documentElement.dataset.scenePainted = "unknown";
    }
  }

  function render() {
    const elapsed = clock.getElapsedTime();
    livePrimary.lerp(new THREE.Color(activeScene.primary), 0.045);
    liveSecondary.lerp(new THREE.Color(activeScene.secondary), 0.045);

    edgeMaterial.color.copy(livePrimary);
    coreMaterial.color.copy(livePrimary);
    coreMaterial.emissive.copy(livePrimary);
    nodeMaterial.color.copy(liveSecondary);
    rim.color.copy(livePrimary);
    glassMaterial.color.lerp(new THREE.Color(0x26345d).lerp(livePrimary, activeScene.depth), 0.04);

    const pointerDriftX = reducedMotion ? 0 : (pointerX - 0.5) * 0.68;
    const pointerDriftY = reducedMotion ? 0 : (pointerY - 0.5) * -0.46;
    camera.position.x += (pointerDriftX - camera.position.x + 0.6) * 0.035;
    camera.position.y += (1.16 + pointerDriftY - camera.position.y) * 0.035;
    camera.lookAt(0, -0.1, 0);

    chamber.rotation.y += reducedMotion ? 0 : activeScene.spin * 0.0028;
    chamber.rotation.x = -0.14 + Math.sin(elapsed * 0.28) * 0.025;
    ringGroup.rotation.z += reducedMotion ? 0 : activeScene.spin * 0.0036;
    core.rotation.x += reducedMotion ? 0 : 0.006;
    core.rotation.y += reducedMotion ? 0 : 0.008;

    nodeMeshes.forEach((node, index) => {
      node.scale.setScalar(1 + Math.sin(elapsed * 1.4 + index) * 0.18);
    });

    renderer.render(scene, camera);
    markPaintedIfReady();
    if (!reducedMotion) window.requestAnimationFrame(render);
  }

  render();
}

try {
  createScene();
} catch (error) {
  console.warn("[Synod] 3D scene unavailable", error);
  document.documentElement.dataset.scenePainted = "false";
  document.documentElement.dataset.sceneError = error?.message || "unknown";
  canvas.classList.add("scene-unavailable");
}
