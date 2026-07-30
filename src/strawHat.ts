import * as THREE from "three";

export interface StrawHatOptions {
  seed?: number;
  textureBaseUrl?: string;
  detail?: "balanced" | "high";
}

export type StrawHatPartId = "brim" | "crown" | "crownTop" | "interior";

export interface StrawHatPart {
  id: StrawHatPartId;
  label: string;
  root: THREE.Object3D;
  pickables: THREE.Object3D[];
  explodeVector: THREE.Vector3;
}

export interface StrawHatRuntime {
  parts: Map<StrawHatPartId, StrawHatPart>;
  pickables: THREE.Object3D[];
  collisionProxies: Map<StrawHatPartId, THREE.Object3D>;
  explodeGroups: StrawHatPart[];
  ready: Promise<void>;
}

type StrawMaterialSet = {
  main: THREE.MeshPhysicalMaterial;
  accent: THREE.MeshPhysicalMaterial;
  interior: THREE.MeshPhysicalMaterial;
  textures: THREE.Texture[];
  ready: Promise<void>;
};

const ORIGINAL_POSITION = "strawHatOriginalPosition";

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nameMesh<T extends THREE.Object3D>(
  object: T,
  name: string,
  partId: StrawHatPartId,
  explodeWithParent = false,
): T {
  object.name = name;
  object.userData.partId = partId;
  object.userData.explodeWithParent = explodeWithParent;
  object.userData[ORIGINAL_POSITION] = object.position.clone();
  return object;
}

function makeStrawDataTexture(
  seed: number,
  channel: "albedo" | "roughness" | "height" | "normal" | "ao",
): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const random = seededRandom(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fiber = Math.sin((x * 0.78 + y * 0.19) * Math.PI);
      const cross = Math.sin((x * 0.34 - y * 0.62) * Math.PI);
      const coarse = Math.sin(y * 0.145) * 0.5 + Math.sin(y * 0.039 + x * 0.018) * 0.5;
      const noise = random() - 0.5;
      if (channel === "albedo") {
        const light = 0.88 + coarse * 0.035 + fiber * 0.025 + noise * 0.07;
        data[i] = THREE.MathUtils.clamp(224 * light, 0, 255);
        data[i + 1] = THREE.MathUtils.clamp(190 * light, 0, 255);
        data[i + 2] = THREE.MathUtils.clamp(142 * light, 0, 255);
      } else if (channel === "roughness") {
        const value = THREE.MathUtils.clamp(204 + fiber * 13 + noise * 25, 145, 245);
        data[i] = data[i + 1] = data[i + 2] = value;
      } else if (channel === "ao") {
        const groove = Math.max(0, -fiber * 0.65 - cross * 0.35);
        const value = THREE.MathUtils.clamp(238 - groove * 52 + noise * 7, 165, 248);
        data[i] = data[i + 1] = data[i + 2] = value;
      } else if (channel === "height") {
        const value = THREE.MathUtils.clamp(128 + fiber * 38 + cross * 16 + noise * 8, 60, 198);
        data[i] = data[i + 1] = data[i + 2] = value;
      } else {
        data[i] = THREE.MathUtils.clamp(128 + fiber * 22 + noise * 4, 90, 166);
        data[i + 1] = THREE.MathUtils.clamp(128 + cross * 17 + noise * 4, 96, 160);
        data[i + 2] = 245;
      }
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(7, 7);
  texture.anisotropy = 8;
  texture.colorSpace = channel === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return texture;
}

function createMaterials(seed: number): StrawMaterialSet {
  const albedo = makeStrawDataTexture(seed + 1, "albedo");
  const roughness = makeStrawDataTexture(seed + 2, "roughness");
  const height = makeStrawDataTexture(seed + 3, "height");
  const normal = makeStrawDataTexture(seed + 4, "normal");
  const ao = makeStrawDataTexture(seed + 5, "ao");
  const textures: THREE.Texture[] = [albedo, roughness, height, normal, ao];

  const common: THREE.MeshPhysicalMaterialParameters = {
    map: albedo,
    roughnessMap: roughness,
    normalMap: normal,
    aoMap: ao,
    color: 0xefd3a4,
    roughness: 0.82,
    metalness: 0,
    normalScale: new THREE.Vector2(0.38, 0.38),
    aoMapIntensity: 0.72,
    sheen: 0.08,
    sheenColor: new THREE.Color(0xe5c69b),
    sheenRoughness: 0.82,
    anisotropy: 0.3,
    anisotropyRotation: Math.PI * 0.25,
  };

  const main = new THREE.MeshPhysicalMaterial({ ...common, name: "strawMaterial" });
  const accent = new THREE.MeshPhysicalMaterial({
    ...common,
    name: "fiberAccentMaterial",
    color: 0xe2bf8a,
    roughness: 0.76,
    normalScale: new THREE.Vector2(0.52, 0.52),
  });
  const interior = new THREE.MeshPhysicalMaterial({
    ...common,
    name: "interiorStrawMaterial",
    color: 0x987044,
    roughness: 0.9,
    side: THREE.BackSide,
    normalScale: new THREE.Vector2(0.28, 0.28),
  });
  return { main, accent, interior, textures, ready: Promise.resolve() };
}

function pushQuad(indices: number[], a: number, b: number, c: number, d: number, flip = false): void {
  if (flip) indices.push(a, c, b, a, d, c);
  else indices.push(a, b, c, a, c, d);
}

function createBrimGeometry(radialSegments: number, angularSegments: number): THREE.BufferGeometry {
  const inner = 0.165;
  const outer = 0.5;
  const thickness = 0.0105;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const row = angularSegments + 1;

  const surfaceY = (radius: number, theta: number): number => {
    const t = (radius - inner) / (outer - inner);
    const broadDish = -0.0075 * Math.pow(t, 1.65);
    const irregularEdge = Math.pow(t, 2.8) * (
      0.0042 * Math.sin(theta + 0.45) +
      0.0024 * Math.sin(theta * 3 - 0.8) +
      0.0011 * Math.cos(theta * 7 + 0.2)
    );
    return broadDish + irregularEdge;
  };

  for (let side = 0; side < 2; side++) {
    for (let r = 0; r <= radialSegments; r++) {
      const t = r / radialSegments;
      const radius = THREE.MathUtils.lerp(inner, outer, t);
      for (let a = 0; a <= angularSegments; a++) {
        const theta = (a / angularSegments) * Math.PI * 2;
        positions.push(
          Math.cos(theta) * radius,
          surfaceY(radius, theta) + (side === 0 ? thickness * 0.5 : -thickness * 0.5),
          Math.sin(theta) * radius,
        );
        uvs.push(a / angularSegments, t * 2.8);
      }
    }
  }

  const sideOffset = (radialSegments + 1) * row;
  for (let r = 0; r < radialSegments; r++) {
    for (let a = 0; a < angularSegments; a++) {
      const i = r * row + a;
      pushQuad(indices, i, i + 1, i + row + 1, i + row);
      const j = sideOffset + i;
      pushQuad(indices, j, j + row, j + row + 1, j + 1);
    }
  }
  for (let a = 0; a < angularSegments; a++) {
    const topInner = a;
    const bottomInner = sideOffset + a;
    pushQuad(indices, topInner, bottomInner, bottomInner + 1, topInner + 1, true);
    const topOuter = radialSegments * row + a;
    const bottomOuter = sideOffset + topOuter;
    pushQuad(indices, topOuter, topOuter + 1, bottomOuter + 1, bottomOuter, true);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv1", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createCrownOuterGeometry(segments: number): THREE.LatheGeometry {
  const points = [
    new THREE.Vector2(0.208, 0.002),
    new THREE.Vector2(0.206, 0.028),
    new THREE.Vector2(0.194, 0.095),
    new THREE.Vector2(0.181, 0.166),
    new THREE.Vector2(0.168, 0.221),
    new THREE.Vector2(0.156, 0.246),
    new THREE.Vector2(0.132, 0.263),
    new THREE.Vector2(0.090, 0.274),
    new THREE.Vector2(0.042, 0.279),
    new THREE.Vector2(0.000, 0.281),
  ];
  const geometry = new THREE.LatheGeometry(points, segments);
  geometry.setAttribute("uv1", geometry.getAttribute("uv").clone());
  return geometry;
}

function createInteriorGeometry(segments: number): THREE.LatheGeometry {
  const points = [
    new THREE.Vector2(0.181, -0.002),
    new THREE.Vector2(0.179, 0.030),
    new THREE.Vector2(0.167, 0.096),
    new THREE.Vector2(0.155, 0.163),
    new THREE.Vector2(0.145, 0.210),
    new THREE.Vector2(0.128, 0.232),
    new THREE.Vector2(0.075, 0.246),
    new THREE.Vector2(0.000, 0.250),
  ];
  const geometry = new THREE.LatheGeometry(points, segments);
  geometry.setAttribute("uv1", geometry.getAttribute("uv").clone());
  return geometry;
}

function makeBraidSegmentGeometry(length: number, width: number, height: number): THREE.BufferGeometry {
  const x = length * 0.5;
  const z = width * 0.5;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -x, 0, -z, -x, 0, z, -x, height, 0,
     x, 0, -z,  x, 0, z,  x, height, 0,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0.5,
    1, 0, 1, 1, 1, 0.5,
  ], 2));
  geometry.setAttribute("uv1", geometry.getAttribute("uv").clone());
  geometry.setIndex([
    0, 2, 1, 3, 4, 5,
    0, 3, 5, 0, 5, 2,
    1, 2, 5, 1, 5, 4,
    0, 1, 4, 0, 4, 3,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

function createBrimWeave(
  material: THREE.Material,
  seed: number,
  highDetail: boolean,
): THREE.InstancedMesh {
  const ringCount = highDetail ? 25 : 19;
  const angularCount = highDetail ? 128 : 104;
  const total = ringCount * angularCount;
  const segment = makeBraidSegmentGeometry(0.019, 0.0052, 0.0016);
  const mesh = new THREE.InstancedMesh(segment, material, total);
  const dummy = new THREE.Object3D();
  const random = seededRandom(seed);
  const color = new THREE.Color();
  let index = 0;

  for (let ring = 0; ring < ringCount; ring++) {
    const radius = THREE.MathUtils.lerp(0.181, 0.486, ring / Math.max(1, ringCount - 1));
    const t = (radius - 0.165) / 0.335;
    for (let a = 0; a < angularCount; a++) {
      const theta = (a / angularCount) * Math.PI * 2;
      const y = -0.0075 * Math.pow(t, 1.65) +
        Math.pow(t, 2.8) * (0.0042 * Math.sin(theta + 0.45) + 0.0024 * Math.sin(theta * 3 - 0.8));
      dummy.position.set(Math.cos(theta) * radius, y + 0.0061, Math.sin(theta) * radius);
      dummy.rotation.set(0, -theta - Math.PI * 0.5 + (ring % 2 ? 0.24 : -0.24), 0);
      const segmentCoverage = (radius * Math.PI * 2 / angularCount * 0.92) / 0.019;
      dummy.scale.set(segmentCoverage * (0.94 + random() * 0.12), 0.8 + random() * 0.5, 0.86 + random() * 0.2);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      color.setHSL(0.095 + (random() - 0.5) * 0.018, 0.42, 0.56 + (random() - 0.5) * 0.11);
      mesh.setColorAt(index, color);
      index++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function crownRadiusAt(y: number): number {
  const t = THREE.MathUtils.clamp(y / 0.242, 0, 1);
  return THREE.MathUtils.lerp(0.211, 0.160, t) + 0.004 * Math.sin(t * Math.PI);
}

function createCrownWeave(
  material: THREE.Material,
  seed: number,
  highDetail: boolean,
  direction: 1 | -1,
): THREE.InstancedMesh {
  const rows = highDetail ? 19 : 15;
  const around = highDetail ? 96 : 72;
  const segment = makeBraidSegmentGeometry(0.019, 0.0041, 0.00135);
  const mesh = new THREE.InstancedMesh(segment, material, rows * around);
  const dummy = new THREE.Object3D();
  const random = seededRandom(seed + direction * 17);
  const color = new THREE.Color();
  let index = 0;
  for (let row = 0; row < rows; row++) {
    const y = THREE.MathUtils.lerp(0.018, 0.251, row / Math.max(rows - 1, 1));
    const radius = crownRadiusAt(y) + 0.004;
    for (let a = 0; a < around; a++) {
      const theta = (a / around) * Math.PI * 2 + (row % 2) * 0.018;
      dummy.position.set(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
      dummy.rotation.set(0, -theta - Math.PI * 0.5, direction * 0.50);
      dummy.scale.set(0.9 + random() * 0.18, 0.75 + random() * 0.45, 0.88 + random() * 0.18);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      color.setHSL(0.098 + (random() - 0.5) * 0.018, 0.43, 0.54 + (random() - 0.5) * 0.10);
      mesh.setColorAt(index, color);
      index++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function createTopCoils(material: THREE.Material, highDetail: boolean): THREE.InstancedMesh {
  const rings = highDetail ? 11 : 8;
  const geometry = new THREE.TorusGeometry(0.1, 0.00165, 5, 96);
  geometry.rotateX(Math.PI * 0.5);
  const mesh = new THREE.InstancedMesh(geometry, material, rings);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < rings; i++) {
    const radius = THREE.MathUtils.lerp(0.025, 0.153, i / Math.max(1, rings - 1));
    const domeY = 0.281 - 0.027 * Math.pow(radius / 0.153, 2);
    dummy.position.set(0, domeY + 0.002, 0);
    dummy.scale.set(radius / 0.1, 1, radius / 0.1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function createWarpedEdge(material: THREE.Material): THREE.Mesh {
  const points: THREE.Vector3[] = [];
  const count = 192;
  for (let i = 0; i <= count; i++) {
    const theta = (i / count) * Math.PI * 2;
    const radius = 0.497;
    const y = -0.0075 + 0.0042 * Math.sin(theta + 0.45) + 0.0024 * Math.sin(theta * 3 - 0.8);
    points.push(new THREE.Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius));
  }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 256, 0.0048, 6, true), material);
}

function createPart(
  id: StrawHatPartId,
  label: string,
  root: THREE.Object3D,
  explodeVector: THREE.Vector3,
): StrawHatPart {
  const pickables: THREE.Object3D[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.InstancedMesh) {
      if (node.visible && !node.userData.collider) pickables.push(node);
    }
  });
  return { id, label, root, pickables, explodeVector };
}

function addCollider(name: string, geometry: THREE.BufferGeometry, partId: StrawHatPartId): THREE.Mesh {
  const collider = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
  collider.name = name;
  collider.visible = false;
  collider.userData.collider = true;
  collider.userData.partId = partId;
  return collider;
}

export function createStrawHatModel(options: StrawHatOptions = {}): THREE.Group {
  const seed = options.seed ?? 341927;
  const highDetail = options.detail === "high";
  const textureBaseUrl = options.textureBaseUrl ?? "./textures/reference-pbr";
  const materials = createMaterials(seed);

  const root = new THREE.Group();
  root.name = "hatRoot";
  root.userData.normalizedBrimDiameter = 1;
  root.userData.upAxis = "Y";
  root.userData.sourceInference = "Rear, underside and interior are symmetry-based single-image inferences.";
  root.userData.referencePbrEvidenceBaseUrl = textureBaseUrl;
  root.userData.generatedPbrChannels = ["albedo", "roughness", "height", "normal", "ao"];

  const brimAssembly = new THREE.Group();
  brimAssembly.name = "brimAssembly";
  brimAssembly.userData.partId = "brim";
  brimAssembly.userData[ORIGINAL_POSITION] = brimAssembly.position.clone();
  root.add(brimAssembly);

  const crownAssembly = new THREE.Group();
  crownAssembly.name = "crownAssembly";
  crownAssembly.userData.partId = "crown";
  crownAssembly.userData[ORIGINAL_POSITION] = crownAssembly.position.clone();
  root.add(crownAssembly);

  const brimShell = nameMesh(
    new THREE.Mesh(createBrimGeometry(highDetail ? 22 : 18, highDetail ? 256 : 192), materials.main),
    "brimShell",
    "brim",
  );
  brimAssembly.add(brimShell);

  const brimWeave = nameMesh(createBrimWeave(materials.accent, seed, highDetail), "brimWeave", "brim", true);
  brimAssembly.add(brimWeave);

  const brimEdge = nameMesh(createWarpedEdge(materials.accent), "brimEdge", "brim", true);
  brimAssembly.add(brimEdge);

  const crownShell = nameMesh(
    new THREE.Mesh(createCrownOuterGeometry(highDetail ? 192 : 144), materials.main),
    "crownShell",
    "crown",
  );
  crownAssembly.add(crownShell);

  const crownWeave = new THREE.Group();
  crownWeave.name = "crownWeave";
  crownWeave.userData.partId = "crown";
  crownWeave.userData.explodeWithParent = true;
  const crownWeaveA = nameMesh(createCrownWeave(materials.accent, seed + 101, highDetail, 1), "crownWeaveDetailA", "crown", true);
  const crownWeaveB = nameMesh(createCrownWeave(materials.accent, seed + 211, highDetail, -1), "crownWeaveDetailB", "crown", true);
  crownWeave.add(crownWeaveA, crownWeaveB);
  crownAssembly.add(crownWeave);

  const seam = nameMesh(
    new THREE.Mesh(new THREE.TorusGeometry(0.203, 0.0062, 7, 192), materials.accent),
    "junctionBand",
    "crown",
    true,
  );
  seam.rotation.x = Math.PI * 0.5;
  seam.position.y = 0.010;
  crownAssembly.add(seam);

  const crownTop = new THREE.Group();
  crownTop.name = "crownTop";
  crownTop.userData.partId = "crownTop";
  crownTop.userData[ORIGINAL_POSITION] = crownTop.position.clone();
  crownAssembly.add(crownTop);
  const topCoils = nameMesh(createTopCoils(materials.accent, highDetail), "crownTopWeaveDetail", "crownTop", true);
  crownTop.add(topCoils);

  const interior = new THREE.Group();
  interior.name = "interior";
  interior.userData.partId = "interior";
  interior.userData[ORIGINAL_POSITION] = interior.position.clone();
  crownAssembly.add(interior);
  const innerShell = nameMesh(
    new THREE.Mesh(createInteriorGeometry(highDetail ? 160 : 120), materials.interior),
    "interiorShell",
    "interior",
  );
  interior.add(innerShell);

  const collisionProxies = new Map<StrawHatPartId, THREE.Object3D>();
  const brimCollider = addCollider("brimCollisionProxy", new THREE.CylinderGeometry(0.5, 0.5, 0.018, 48), "brim");
  const crownCollider = addCollider("crownCollisionProxy", new THREE.CylinderGeometry(0.158, 0.207, 0.27, 48), "crown");
  crownCollider.position.y = 0.135;
  brimAssembly.add(brimCollider);
  crownAssembly.add(crownCollider);
  collisionProxies.set("brim", brimCollider);
  collisionProxies.set("crown", crownCollider);

  const brimPart = createPart("brim", "帽檐", brimAssembly, new THREE.Vector3(0, -0.10, 0));
  const crownPart = createPart("crown", "帽冠", crownAssembly, new THREE.Vector3(0, 0.13, 0));
  const topPart = createPart("crownTop", "帽顶盘绕", crownTop, new THREE.Vector3(0, 0.21, 0));
  const interiorPart = createPart("interior", "帽内腔", interior, new THREE.Vector3(0, 0.06, -0.11));
  const parts = new Map<StrawHatPartId, StrawHatPart>([
    ["brim", brimPart],
    ["crown", crownPart],
    ["crownTop", topPart],
    ["interior", interiorPart],
  ]);
  const pickables = [...new Set([...parts.values()].flatMap((part) => part.pickables))];

  const runtime: StrawHatRuntime = {
    parts,
    pickables,
    collisionProxies,
    explodeGroups: [brimPart, crownPart, topPart, interiorPart],
    ready: materials.ready,
  };
  root.userData.sculptRuntime = runtime;
  root.userData.resources = {
    geometries: [...new Set(pickables.map((object) => (object as THREE.Mesh).geometry).filter(Boolean))],
    materials: [materials.main, materials.accent, materials.interior],
    textures: materials.textures,
  };
  return root;
}

export function resolveStrawHatPart(
  object: THREE.Object3D | null,
  root?: THREE.Group,
): StrawHatPart | null {
  if (!object) return null;
  let current: THREE.Object3D | null = object;
  while (current) {
    const id = current.userData.partId as StrawHatPartId | undefined;
    if (id && root) {
      const runtime = root.userData.sculptRuntime as StrawHatRuntime | undefined;
      return runtime?.parts.get(id) ?? null;
    }
    if (id) return { id, label: id, root: current, pickables: [object], explodeVector: new THREE.Vector3() };
    current = current.parent;
  }
  return null;
}

export function setStrawHatExplodeProgress(root: THREE.Group, progress: number): void {
  const runtime = root.userData.sculptRuntime as StrawHatRuntime | undefined;
  if (!runtime) return;
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  for (const part of runtime.explodeGroups) {
    const original = part.root.userData[ORIGINAL_POSITION] as THREE.Vector3 | undefined;
    if (!original) continue;
    part.root.position.copy(original).addScaledVector(part.explodeVector, t);
  }
}

export function resetStrawHatModel(root: THREE.Group): void {
  setStrawHatExplodeProgress(root, 0);
  root.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.InstancedMesh) {
      const material = node.material;
      const list = Array.isArray(material) ? material : [material];
      for (const item of list) {
        if (item instanceof THREE.MeshPhysicalMaterial) item.emissive.set(0x000000);
      }
    }
  });
}

export function disposeStrawHatModel(root: THREE.Group): void {
  const resources = root.userData.resources as {
    geometries?: THREE.BufferGeometry[];
    materials?: THREE.Material[];
    textures?: THREE.Texture[];
  } | undefined;
  resources?.geometries?.forEach((geometry) => geometry.dispose());
  resources?.materials?.forEach((material) => material.dispose());
  resources?.textures?.forEach((texture) => texture.dispose());
  root.traverse((node) => {
    if (node.userData.collider && node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material.dispose());
    }
  });
  root.clear();
  delete root.userData.sculptRuntime;
  delete root.userData.resources;
}
