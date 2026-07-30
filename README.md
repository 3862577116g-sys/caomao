# 程序化 Three.js 草帽

这是一个独立的 Vite + TypeScript + 原生 Three.js 项目。它依据单张草帽参考图重建实时 3D 产品模型，不依赖 `.glb`、下载模型或外部素材包。

## 运行

```bash
npm install
npm run dev
```

生产验证：

```bash
npm run typecheck
npm run build
npm run preview
```

## 公网演示

GitHub Pages 地址：

`https://3862577116g-sys.github.io/caomao/`

推送到 `main` 后，`.github/workflows/deploy-pages.yml` 会自动执行类型检查、生产构建和 Pages 部署。Vite 的生产基础路径固定为 `/caomao/`。

## 前端集成

模型模块是 [`src/strawHat.ts`](./src/strawHat.ts)，不依赖 renderer、camera、DOM 或 OrbitControls。

```ts
import * as THREE from "three";
import {
  createStrawHatModel,
  disposeStrawHatModel,
  resolveStrawHatPart,
  setStrawHatExplodeProgress,
  resetStrawHatModel,
} from "./strawHat";

const scene = new THREE.Scene();
const hat = createStrawHatModel({
  seed: 341927,
  detail: "balanced",
});

scene.add(hat);

// 射线拾取后：
const part = resolveStrawHatPart(intersection.object, hat);
console.log(part?.id, part?.label);

// 0～1 拆解：
setStrawHatExplodeProgress(hat, 0.6);
resetStrawHatModel(hat);

// 页面销毁时：
scene.remove(hat);
disposeStrawHatModel(hat);
```

主要 API：

- `createStrawHatModel(options?): THREE.Group`：同步返回模型；固定种子保证可复现。
- `resolveStrawHatPart(object, root)`：把被点击的可见网格解析成稳定语义部件。
- `setStrawHatExplodeProgress(root, progress)`：设置 0～1 的拆解进度。
- `resetStrawHatModel(root)`：复位拆解与临时材质状态。
- `disposeStrawHatModel(root)`：释放 geometry、material、DataTexture 和碰撞代理资源。

## 坐标与层级

- Y 轴向上。
- `hatRoot` 位于原点附近。
- 帽檐直径归一化为 1 个世界单位；在业务场景中缩放 `hatRoot` 即可。
- 冠檐接缝位于 `y ≈ 0`，帽冠最高点约为 `y = 0.281`。

稳定层级：

```text
hatRoot
├─ brimAssembly
│  ├─ brimShell
│  ├─ brimWeave
│  └─ brimEdge
└─ crownAssembly
   ├─ crownShell
   ├─ crownWeave
   │  ├─ crownWeaveDetailA
   │  └─ crownWeaveDetailB
   ├─ junctionBand
   ├─ crownTop
   │  └─ crownTopWeaveDetail
   └─ interior
      └─ interiorShell
```

`root.userData.sculptRuntime` 提供：

- `parts`：点击、拆解共用的语义部件映射。
- `pickables`：供 Raycaster 使用的可见对象集合。
- `collisionProxies`：帽檐和帽冠的低成本碰撞代理。
- `explodeGroups`：拆解分组。
- `ready`：资源准备 Promise；当前程序化 DataTexture 同步生成，因此会立即完成。

所有表面浮雕都带有 `userData.explodeWithParent = true`，会跟随所属语义部件移动。

## 几何与材质

- 帽冠：旋转剖面的外壳和独立内腔，具有锥度、顶部圆弧与合理壁厚。
- 帽檐：双面径向薄壳，固定种子的低幅度弯曲与边缘起伏。
- 编织：帽檐同心纤维、帽冠双向人字纤维、顶部盘绕和边缘包边使用真实几何与 `InstancedMesh`。
- PBR：运行时分别生成 albedo、roughness、height、normal、AO 五个独立 DataTexture 通道；height 作为独立证据/扩展通道保存，轮廓相关起伏由真实几何承担。
- 草色依据参考图提取的主色板和粗糙度范围生成；`public/textures/reference-pbr` 保留单图 PBR 提取证据。

## 演示功能

演示页包含 OrbitControls、自动旋转、部件点击识别、拆解滑块、相机复位、运行时统计及参考/侧前方/侧面/顶部/底部确定性视角。

可用 URL：

- `?view=reference`
- `?view=threeQuarter`
- `?view=side`
- `?view=top`
- `?view=underside`
- 加 `&review=1` 隐藏界面，便于自动截图。
- 加 `&blockout=1` 禁用贴图并使用灰色材质，便于轮廓门禁。

## 性能与验证结果

平衡档实测：

- 三角形：65,394（目标 ≤ 80,000）
- Draw calls：10（目标 ≤ 40）
- 可见/辅助 geometry：10
- WebGL 运行时纹理统计：5（含阴影贴图；模型生成 5 个独立 PBR 通道，其中 4 个上传到当前材质）
- TypeScript 类型检查：通过
- Vite 生产构建：通过
- 部件覆盖：0 error、0 warning
- 全局视觉评分：0.76；所有关键特征评分 ≥ 0.7

质量证据在 `sculpt` 中：

- `pre-spec-assessment.json`
- `detail-inventory.json`
- `object-sculpt-spec.json`
- `coverage-report.json`
- `visual-review.json`
- `comparison-reference.png`
- `renders/`

## 单图推断范围

参考图只提供了正面偏俯视视角。以下内容按旋转对称和常见草帽结构补全，并非图片直接证据：

- 背面几何和背面编织连续性。
- 帽檐底面。
- 帽冠内部空腔及内壁纹理。
- 精确制造尺寸、真实纤维交错顺序和单根飞丝。

因此本交付适用于可信的网页实时产品展示，不应作为制造级逆向工程模型。
