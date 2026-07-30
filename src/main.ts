import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createStrawHatModel,
  disposeStrawHatModel,
  resolveStrawHatPart,
  resetStrawHatModel,
  setStrawHatExplodeProgress,
  type StrawHatRuntime,
} from "./strawHat";
import "./style.css";

declare global {
  interface Window {
    __STRAW_HAT_READY__?: boolean;
    __STRAW_HAT_STATS__?: Record<string, number>;
  }
}

type ViewName = "reference" | "threeQuarter" | "side" | "top" | "underside";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app is missing");

app.innerHTML = `
  <main class="stage">
    <div class="panel">
      <h1 class="title">程序化草帽 · Three.js</h1>
      <p class="subtitle">Y 轴向上，帽檐直径 = 1。几何、编织浮雕与 PBR 贴图均由本项目生成。</p>
      <div class="row">
        <label for="explode">拆解</label>
        <input id="explode" type="range" min="0" max="1" step="0.01" value="0" />
      </div>
      <div class="row">
        <label for="autoRotate">自动旋转</label>
        <input id="autoRotate" type="checkbox" />
      </div>
      <div class="buttons">
        <button data-view="reference">参考视角</button>
        <button data-view="threeQuarter">侧前方</button>
        <button data-view="side">侧面</button>
        <button data-view="top">顶部</button>
        <button data-view="underside">底部</button>
        <button id="reset">复位</button>
      </div>
      <div id="selected" class="selected">点击帽子部件以识别</div>
      <div id="stats" class="stats">正在初始化模型…</div>
    </div>
    <div class="hint">拖动旋转 · 滚轮缩放 · 右键平移</div>
  </main>
`;

const stage = app.querySelector<HTMLElement>(".stage")!;
const selected = app.querySelector<HTMLDivElement>("#selected")!;
const stats = app.querySelector<HTMLDivElement>("#stats")!;
const explode = app.querySelector<HTMLInputElement>("#explode")!;
const autoRotate = app.querySelector<HTMLInputElement>("#autoRotate")!;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe4e1da);

const camera = new THREE.PerspectiveCamera(31, stage.clientWidth / stage.clientHeight, 0.01, 20);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 0.66;
controls.maxDistance = 2.4;
controls.target.set(0, 0.095, 0);

const cameraViews: Record<ViewName, THREE.Vector3> = {
  reference: new THREE.Vector3(0.84, 0.43, 1.12),
  threeQuarter: new THREE.Vector3(1.08, 0.48, 0.78),
  side: new THREE.Vector3(1.42, 0.25, 0.02),
  top: new THREE.Vector3(0.04, 1.45, 0.03),
  underside: new THREE.Vector3(0.82, -0.54, 1.05),
};

function setView(name: ViewName): void {
  camera.position.copy(cameraViews[name]);
  controls.target.set(0, name === "underside" ? 0.06 : 0.105, 0);
  controls.update();
}

const hemi = new THREE.HemisphereLight(0xfff7ea, 0x6b5844, 1.45);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffe2bb, 4.1);
key.name = "studioKey";
key.position.set(-1.3, 1.6, 1.7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -0.75;
key.shadow.camera.right = key.shadow.camera.top = 0.75;
key.shadow.bias = -0.0003;
scene.add(key);

const fill = new THREE.DirectionalLight(0xd8e2f0, 1.7);
fill.name = "studioFill";
fill.position.set(1.3, 0.7, 1.0);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffefd2, 2.4);
rim.name = "studioRim";
rim.position.set(0.4, 1.1, -1.6);
scene.add(rim);

const underFill = new THREE.DirectionalLight(0xd8c7ad, 0.72);
underFill.name = "undersideFill";
underFill.position.set(0.2, -1.2, 0.8);
scene.add(underFill);

const contactPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(3, 3),
  new THREE.ShadowMaterial({ color: 0x5f5243, opacity: 0.19 }),
);
contactPlane.name = "contactShadowPlane";
contactPlane.rotation.x = -Math.PI * 0.5;
contactPlane.position.y = -0.025;
contactPlane.receiveShadow = true;
scene.add(contactPlane);

const hat = createStrawHatModel({
  seed: 341927,
  detail: new URLSearchParams(location.search).get("detail") === "high" ? "high" : "balanced",
});
scene.add(hat);
hat.traverse((node) => {
  if (node instanceof THREE.Mesh || node instanceof THREE.InstancedMesh) {
    node.castShadow = !node.userData.explodeWithParent;
    node.receiveShadow = true;
    if (new URLSearchParams(location.search).get("blockout") === "1") {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshPhysicalMaterial) {
          material.map = null;
          material.roughnessMap = null;
          material.normalMap = null;
          material.aoMap = null;
          material.color.set(0xb8b3aa);
          material.roughness = 0.9;
          material.needsUpdate = true;
        }
      });
    }
  }
});
const runtime = hat.userData.sculptRuntime as StrawHatRuntime;

explode.addEventListener("input", () => setStrawHatExplodeProgress(hat, Number(explode.value)));
autoRotate.addEventListener("change", () => { controls.autoRotate = autoRotate.checked; });
app.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view as ViewName));
});
app.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", () => {
  resetStrawHatModel(hat);
  explode.value = "0";
  controls.autoRotate = false;
  autoRotate.checked = false;
  selected.textContent = "点击帽子部件以识别";
  setView("reference");
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener("pointerdown", (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(runtime.pickables, false)[0];
  const part = resolveStrawHatPart(hit?.object ?? null, hat);
  selected.textContent = part ? `已选择：${part.label} · ${part.id}` : "未命中可识别部件";
});

function updateStats(): void {
  const info = renderer.info.render;
  const memory = renderer.info.memory;
  const statValues = {
    triangles: info.triangles,
    drawCalls: info.calls,
    geometries: memory.geometries,
    textures: memory.textures,
  };
  window.__STRAW_HAT_STATS__ = statValues;
  stats.textContent =
    `Triangles  ${info.triangles.toLocaleString()}\n` +
    `Draw calls ${info.calls}\n` +
    `Geometry   ${memory.geometries} · Textures ${memory.textures}`;
}

function resize(): void {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

const initialView = new URLSearchParams(location.search).get("view") as ViewName | null;
setView(initialView && cameraViews[initialView] ? initialView : "reference");
if (new URLSearchParams(location.search).get("review") === "1") {
  app.querySelector<HTMLElement>(".panel")!.style.display = "none";
  app.querySelector<HTMLElement>(".hint")!.style.display = "none";
}

let frames = 0;
function render(): void {
  controls.update();
  renderer.render(scene, camera);
  if (frames++ % 30 === 0) updateStats();
  requestAnimationFrame(render);
}

runtime.ready.finally(() => {
  window.__STRAW_HAT_READY__ = true;
  updateStats();
});
render();

window.addEventListener("beforeunload", () => {
  disposeStrawHatModel(hat);
  contactPlane.geometry.dispose();
  (contactPlane.material as THREE.Material).dispose();
  renderer.dispose();
});
