import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * createAnatomicalSegmentGeometry
 * 构造拟真人手有机平滑指节几何体 (Tapered Capsule)
 * - 底部：半球形球冠 (直径与上一关节重合)
 * - 中部：微收腰、剖面微扁圆的人体工学指节柱
 * - 顶部：平滑球冠 (直径与下一关节重合)
 * 连续指节之间球心同心重合，手指在任何弯曲角度均无缝隙、无穿模棱角
 */
function createAnatomicalSegmentGeometry(radialSegments = 16, heightSegments = 8) {
  const geom = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const rings = heightSegments + 1;
  for (let r = 0; r <= rings; r++) {
    const v = r / rings; // 0 (底部关节) 到 1 (顶部关节)

    let radiusRatio = 1.0;
    if (v < 0.2) {
      // 底部球冠
      const angle = (v / 0.2) * (Math.PI * 0.5);
      radiusRatio = Math.sin(angle);
    } else if (v > 0.8) {
      // 顶部球冠
      const angle = ((1 - v) / 0.2) * (Math.PI * 0.5);
      radiusRatio = Math.sin(angle) * 0.88;
    } else {
      // 中间段：近端到远端微收腰自然渐变
      const midT = (v - 0.2) / 0.6;
      radiusRatio = (1.0 - 0.12 * midT) * (1.0 - 0.03 * Math.sin(midT * Math.PI));
    }

    const y = v; // 轴向高度 0 到 1

    for (let s = 0; s <= radialSegments; s++) {
      const u = s / radialSegments;
      const theta = u * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // 指腹方向略微扁平 (侧扁比 0.94，呈现自然人手椭圆横截面)
      const x = cosT * radiusRatio;
      const z = sinT * radiusRatio * 0.94;

      positions.push(x, y, z);

      const nx = cosT;
      const ny = v < 0.2 ? -Math.cos((v / 0.2) * Math.PI * 0.5) : v > 0.8 ? Math.cos(((1 - v) / 0.2) * Math.PI * 0.5) : 0;
      const nz = sinT;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / len, ny / len, nz / len);

      uvs.push(u, v);
    }
  }

  const ringVerts = radialSegments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < radialSegments; s++) {
      const a = r * ringVerts + s;
      const b = (r + 1) * ringVerts + s;
      const c = (r + 1) * ringVerts + (s + 1);
      const d = r * ringVerts + (s + 1);

      indices.push(a, b, d);
      indices.push(d, b, c);
    }
  }

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/**
 * createCurvedFingernailGeometry
 * 构造拟真人手指甲盖曲面几何体 (Curved Shell)
 * 具有横向 C 弧曲率与纵向微弧度，贴合指尖背部
 */
function createCurvedFingernailGeometry() {
  const geom = new THREE.BufferGeometry();
  const widthSegments = 8;
  const lengthSegments = 6;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let l = 0; l <= lengthSegments; l++) {
    const v = l / lengthSegments;
    const y = v; // 甲根到甲尖
    const archY = Math.sin(v * Math.PI) * 0.08;

    for (let w = 0; w <= widthSegments; w++) {
      const u = w / widthSegments;
      const uNorm = (u - 0.5) * 2; // -1 到 +1
      const archX = (1 - uNorm * uNorm) * 0.26;

      const x = uNorm * 0.48;
      const z = archX + archY;

      positions.push(x, y, z);
      normals.push(0, 0, 1);
      uvs.push(u, v);
    }
  }

  const rowVerts = widthSegments + 1;
  for (let l = 0; l < lengthSegments; l++) {
    for (let w = 0; w < widthSegments; w++) {
      const a = l * rowVerts + w;
      const b = (l + 1) * rowVerts + w;
      const c = (l + 1) * rowVerts + (w + 1);
      const d = l * rowVerts + (w + 1);

      indices.push(a, b, d);
      indices.push(d, b, c);
    }
  }

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/**
 * createAnatomicalPalmGeometry
 * 构造具有肌肉丰满度与掌弓曲率的有机 3D 手掌网格 (5行 x 7列 细分曲面)
 * 正反双层 (手背 + 手心) + 侧边缘无缝封闭缝合
 */
function createAnatomicalPalmGeometry() {
  const geom = new THREE.BufferGeometry();
  const rows = 5;
  const cols = 7;
  const numSurface = rows * cols;
  const totalVerts = numSurface * 2;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = [];

  // 1. 手背上表面
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i0 = r * cols + c;
      const i1 = r * cols + (c + 1);
      const i2 = (r + 1) * cols + c;
      const i3 = (r + 1) * cols + (c + 1);
      indices.push(i0, i1, i2);
      indices.push(i1, i3, i2);
    }
  }

  // 2. 手心下表面 (反向绕序)
  const off = numSurface;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i0 = off + r * cols + c;
      const i1 = off + r * cols + (c + 1);
      const i2 = off + (r + 1) * cols + c;
      const i3 = off + (r + 1) * cols + (c + 1);
      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }
  }

  // 3. 侧面厚度缝合
  // (a) 底部 (手腕) r = 0
  for (let c = 0; c < cols - 1; c++) {
    const top0 = c;
    const top1 = c + 1;
    const bot0 = off + c;
    const bot1 = off + c + 1;
    indices.push(top0, bot0, top1);
    indices.push(top1, bot0, bot1);
  }
  // (b) 顶部 (指根/指蹼) r = rows - 1
  const rTop = rows - 1;
  for (let c = 0; c < cols - 1; c++) {
    const top0 = rTop * cols + c;
    const top1 = rTop * cols + (c + 1);
    const bot0 = off + rTop * cols + c;
    const bot1 = off + rTop * cols + (c + 1);
    indices.push(top0, top1, bot0);
    indices.push(top1, bot1, bot0);
  }
  // (c) 拇指外侧边 c = 0
  for (let r = 0; r < rows - 1; r++) {
    const top0 = r * cols;
    const top1 = (r + 1) * cols;
    const bot0 = off + r * cols;
    const bot1 = off + (r + 1) * cols;
    indices.push(top0, top1, bot0);
    indices.push(top1, bot1, bot0);
  }
  // (d) 小指外侧边 c = cols - 1
  for (let r = 0; r < rows - 1; r++) {
    const top0 = r * cols + (cols - 1);
    const top1 = (r + 1) * cols + (cols - 1);
    const bot0 = off + r * cols + (cols - 1);
    const bot1 = off + (r + 1) * cols + (cols - 1);
    indices.push(top0, bot0, top1);
    indices.push(top1, bot0, bot1);
  }

  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  return { geom, rows, cols };
}

/**
 * Hand3DScene - 真实 3D 手势渲染场景 (超逼真有机人体解剖学手模)
 * 
 * 核心升级：
 * 1. 拟真解剖学肌肉与掌弓网格 (Anatomical Palm)：多段细分四边形带曲面，包含大鱼际肌、小鱼际肌、掌心凹陷与指蹼自然过渡
 * 2. 有机无缝平滑指节 (Seamless Contoured Capsules)：微收腰椭圆剖面 + 连续同心球面过渡，各关节弯曲零破绽
 * 3. 3D 立体曲面指甲盖 (3D Curved Fingernails)：自然 C 弧甲盖，高光透亮角蛋白微光泽
 * 4. PBR 次表面皮肤反射系统 (PBR Subsurface Skin)：MeshPhysicalMaterial 次表面散射色 (Sheen) + 柔和清漆油脂光泽
 * 5. 动态防抖自适应滤波 (Adaptive EMA)：静止画线超强防抖，挥手动作零延迟跟手
 */
export class Hand3DScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    // 当前手模风格: 'skin' (拟真皮肤手) | 'model' (开源GLB模型) | 'cyber' (赛博机甲)
    this.currentTheme = 'skin';
    this.visible = true;

    // Three.js 核心对象
    this.renderer = null;
    this.scene = null;
    this.camera = null;

    // 手部对象存储: { Right: handObject, Left: handObject }
    this.hands = {
      Right: null,
      Left: null,
    };

    // 开源 GLTF 模型缓存与加载状态
    this.gltfLoader = new GLTFLoader();
    this.cachedGltfModels = {
      Right: null,
      Left: null,
    };
    this.modelLoadState = {
      Right: 'idle', // 'idle' | 'loading' | 'loaded' | 'failed'
      Left: 'idle',
    };

    // 共享几何体和材质池（零 GC）
    this.materials = {};
    this.sharedGeometries = {};

    this.init();
  }

  // ═══════════════════════════════════════════════════════
  //  初始化 Three.js 场景与光照
  // ═══════════════════════════════════════════════════════

  init() {
    this.scene = new THREE.Scene();

    // 采用与屏幕像素 1:1 精确对应的正交投影相机
    this.camera = new THREE.OrthographicCamera(
      0,
      this.width,
      0,
      this.height,
      -2000,
      2000
    );
    this.camera.position.set(0, 0, 1000);
    this.camera.lookAt(0, 0, 0);

    // WebGLRenderer 透明背景
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setClearColor(0x000000, 0); // 100% 透明，透出底层白色画布

    // 设置拟真人体皮肤照明光影系统
    this._setupLighting();

    // 初始化材质库
    this._initMaterials();

    // 预热加载开源 GLTF 真实模型（本地 public/models/）
    this._preloadOpenSourceModels();

    // 创建双手 3D 容器
    this.hands.Right = this._createHandContainer('Right');
    this.hands.Left = this._createHandContainer('Left');
    this.scene.add(this.hands.Right.group);
    this.scene.add(this.hands.Left.group);
  }

  _setupLighting() {
    // 基础环境漫反射光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(ambientLight);

    // 主方向光（来自前方斜上方，模拟自然日光照在手背）
    const mainDirLight = new THREE.DirectionalLight(0xfffaed, 1.3);
    mainDirLight.position.set(200, -350, 600);
    this.scene.add(mainDirLight);

    // 次表面透光轮廓补光（背光斜下方暖红光，模拟人手软组织透光次表面边缘）
    const sssRimLight = new THREE.DirectionalLight(0xffa278, 0.85);
    sssRimLight.position.set(-200, 350, -400);
    this.scene.add(sssRimLight);

    // 天空冷暖侧补光（勾勒手指侧面高光轮廓）
    const sideLight = new THREE.DirectionalLight(0xc7d2fe, 0.5);
    sideLight.position.set(-350, -200, 400);
    this.scene.add(sideLight);

    // 半球光（天空暖光与地面冷反光）
    const hemiLight = new THREE.HemisphereLight(0xffedd5, 0x1e293b, 0.55);
    this.scene.add(hemiLight);
  }

  _initMaterials() {
    // 1. 拟真人体 PBR 物理皮肤材质 (Realistic Subsurface Skin)
    this.materials.skin = {
      palm: new THREE.MeshPhysicalMaterial({
        color: 0xf5cca8,
        roughness: 0.52,
        metalness: 0.0,
        clearcoat: 0.14,
        clearcoatRoughness: 0.38,
        sheen: 0.45,
        sheenColor: new THREE.Color(0xffa888),
        side: THREE.DoubleSide,
      }),
      finger: new THREE.MeshPhysicalMaterial({
        color: 0xefbe9b,
        roughness: 0.48,
        metalness: 0.0,
        clearcoat: 0.16,
        clearcoatRoughness: 0.35,
        sheen: 0.5,
        sheenColor: new THREE.Color(0xff9c80),
        side: THREE.DoubleSide,
      }),
      joint: new THREE.MeshPhysicalMaterial({
        color: 0xe89e82, // 关节软骨与微血管健康透红
        roughness: 0.52,
        metalness: 0.0,
        clearcoat: 0.12,
        sheen: 0.55,
        sheenColor: new THREE.Color(0xff7562),
        side: THREE.DoubleSide,
      }),
      nail: new THREE.MeshPhysicalMaterial({
        color: 0xffeae3, // 指甲盖自然半透角蛋白象牙粉白
        roughness: 0.16,
        metalness: 0.02,
        clearcoat: 0.92,
        clearcoatRoughness: 0.1,
        reflectivity: 0.65,
        side: THREE.DoubleSide,
      }),
      wrist: new THREE.MeshPhysicalMaterial({
        color: 0xf2c6a2,
        roughness: 0.54,
        metalness: 0.0,
        clearcoat: 0.1,
        sheen: 0.4,
        sheenColor: new THREE.Color(0xffa280),
        side: THREE.DoubleSide,
      }),
    };

    // 2. 赛博机甲材质 (Cyberpunk Titanium Mecha)
    this.materials.cyber = {
      palm: new THREE.MeshStandardMaterial({
        color: 0x18202c,
        roughness: 0.22,
        metalness: 0.88,
        side: THREE.DoubleSide,
      }),
      finger: new THREE.MeshStandardMaterial({
        color: 0x242e3d,
        roughness: 0.25,
        metalness: 0.92,
        side: THREE.DoubleSide,
      }),
      joint: new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.85,
        roughness: 0.18,
        metalness: 0.55,
        side: THREE.DoubleSide,
      }),
      nail: new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        emissive: 0x0891b2,
        emissiveIntensity: 1.1,
        roughness: 0.12,
        metalness: 0.35,
        side: THREE.DoubleSide,
      }),
      wrist: new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.2,
        metalness: 0.9,
        side: THREE.DoubleSide,
      }),
    };

    // 3. 悬浮柔和暗影材质
    this.materials.shadow = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });

    // 4. 捏合指示光环材质
    this.materials.pinchHalo = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // 5. 橡皮擦范围指示环材质
    this.materials.eraserField = new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // 预创建高精通用几何体池（零 GC）
    this.sharedGeometries.segment = createAnatomicalSegmentGeometry(16, 8);
    this.sharedGeometries.knuckle = new THREE.SphereGeometry(1, 16, 12);
    this.sharedGeometries.nail = createCurvedFingernailGeometry();
    this.sharedGeometries.wristCuff = new THREE.CylinderGeometry(1, 1.15, 1, 16, 2, false);
    this.sharedGeometries.shadow = new THREE.CircleGeometry(1, 28);
    this.sharedGeometries.ring = new THREE.RingGeometry(0.7, 1.0, 28);
  }

  // ═══════════════════════════════════════════════════════
  //  创建手部 3D 模型层次体系
  // ═══════════════════════════════════════════════════════

  _createHandContainer(handedness) {
    const group = new THREE.Group();
    group.visible = false;

    // 手指骨骼定义：5 根手指
    const fingerDefs = [
      { name: 'thumb', joints: [1, 2, 3, 4], baseR: 15, tipR: 11, nailScale: 1.1 },
      { name: 'index', joints: [5, 6, 7, 8], baseR: 14, tipR: 9.2, nailScale: 1.0 },
      { name: 'middle', joints: [9, 10, 11, 12], baseR: 14.5, tipR: 9.6, nailScale: 1.05 },
      { name: 'ring', joints: [13, 14, 15, 16], baseR: 13.5, tipR: 8.8, nailScale: 0.95 },
      { name: 'pinky', joints: [17, 18, 19, 20], baseR: 12, tipR: 7.8, nailScale: 0.85 },
    ];

    const currentMat = this.materials[this.currentTheme] || this.materials.skin;

    // 1. 拟真解剖学 3D 手掌
    const palmMeshInfo = this._createPalmMesh(currentMat.palm);
    group.add(palmMeshInfo.mesh);

    // 2. 五指平滑指节、掌指关节 (MCP) 与 3D 指甲盖
    const fingers = [];
    fingerDefs.forEach((def) => {
      const fingerObj = {
        name: def.name,
        joints: def.joints,
        baseR: def.baseR,
        tipR: def.tipR,
        nailScale: def.nailScale,
        segments: [],
        knuckles: [],
        nailMesh: null,
      };

      // 掌指关节微隆起 (Knuckle Condyle)
      def.joints.forEach((jointIdx, i) => {
        const kMesh = new THREE.Mesh(this.sharedGeometries.knuckle, currentMat.joint);
        kMesh.visible = true;
        group.add(kMesh);
        fingerObj.knuckles.push({ index: jointIdx, mesh: kMesh, isTip: i === def.joints.length - 1 });
      });

      // 有机平滑指节连接体 (Anatomical Bone Segments)
      for (let s = 0; s < def.joints.length - 1; s++) {
        const fromIdx = def.joints[s];
        const toIdx = def.joints[s + 1];
        const segMesh = new THREE.Mesh(this.sharedGeometries.segment, currentMat.finger);
        segMesh.frustumCulled = false;
        group.add(segMesh);
        fingerObj.segments.push({ from: fromIdx, to: toIdx, mesh: segMesh, stage: s });
      }

      // 3D 曲面立体指甲盖 (位于末节指背)
      const nailMesh = new THREE.Mesh(this.sharedGeometries.nail, currentMat.nail);
      nailMesh.frustumCulled = false;
      group.add(nailMesh);
      fingerObj.nailMesh = nailMesh;

      fingers.push(fingerObj);
    });

    // 3. 手腕基座过渡袖套 (Wrist Cuff)
    const wristMesh = new THREE.Mesh(this.sharedGeometries.wristCuff, currentMat.wrist || currentMat.joint);
    group.add(wristMesh);

    // 4. 开源 GLTF 骨骼模型包装挂载点
    const gltfWrapper = new THREE.Group();
    gltfWrapper.visible = false;
    group.add(gltfWrapper);

    // 5. 接触投影网格 (Drop Shadow)
    const shadowMesh = new THREE.Mesh(this.sharedGeometries.shadow, this.materials.shadow);
    shadowMesh.visible = false;
    group.add(shadowMesh);

    // 6. 捏合作画高光微光环 (Pinch Halo)
    const pinchHaloMesh = new THREE.Mesh(this.sharedGeometries.ring, this.materials.pinchHalo);
    pinchHaloMesh.visible = false;
    group.add(pinchHaloMesh);

    // 7. 橡皮擦范围光环 (Eraser Radius Ring)
    const eraserMesh = new THREE.Mesh(this.sharedGeometries.ring, this.materials.eraserField);
    eraserMesh.visible = false;
    group.add(eraserMesh);

    return {
      group,
      handedness,
      palmMesh: palmMeshInfo.mesh,
      palmMeshInfo,
      fingers,
      wristMesh,
      shadowMesh,
      pinchHaloMesh,
      eraserMesh,
      gltfWrapper,
      gltfModel: null,
      gltfBones: [],
      smoothedPts: null,
    };
  }

  // 构造有机手掌网格
  _createPalmMesh(material) {
    const { geom, rows, cols } = createAnatomicalPalmGeometry();
    const mesh = new THREE.Mesh(geom, material);
    mesh.frustumCulled = false;
    return { mesh, rows, cols };
  }

  // ═══════════════════════════════════════════════════════
  //  预加载开源 GLTF 真实 3D 模型
  // ═══════════════════════════════════════════════════════

  _preloadOpenSourceModels() {
    const loadHand = (handedness) => {
      const fileName = handedness.toLowerCase() === 'left' ? 'left.glb' : 'right.glb';
      const url = `/models/${fileName}`;
      this.modelLoadState[handedness] = 'loading';

      this.gltfLoader.load(
        url,
        (gltf) => {
          this.cachedGltfModels[handedness] = gltf;
          this.modelLoadState[handedness] = 'loaded';
          this._setupGltfModel(handedness, gltf);
        },
        undefined,
        (err) => {
          console.warn(`开源 3D 模型加载提醒 [${handedness}]:`, err?.message || err);
          this.modelLoadState[handedness] = 'failed';
        }
      );
    };

    loadHand('Right');
    loadHand('Left');
  }

  _setupGltfModel(handedness, gltf) {
    const hand = this.hands[handedness];
    if (!hand) return;

    const root = gltf.scene.clone();
    root.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = false;
        node.receiveShadow = false;
        node.material = new THREE.MeshPhysicalMaterial({
          color: 0xf5cca8,
          roughness: 0.5,
          metalness: 0.0,
          clearcoat: 0.15,
          sheen: 0.45,
          sheenColor: new THREE.Color(0xffa888),
        });
      }
    });

    hand.gltfModel = root;
    hand.gltfWrapper.add(root);

    const jointNames = [
      'wrist',
      'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
      'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
      'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
      'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
      'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
    ];

    hand.gltfBones = jointNames.map((jName) => root.getObjectByName(jName)).filter(Boolean);
  }

  // ═══════════════════════════════════════════════════════
  //  每帧手势驱动更新
  // ═══════════════════════════════════════════════════════

  /**
   * 更新并渲染当前帧的 3D 手部姿态
   * @param {Array} handList 手部数组 [{ rawLandmarks, handedness }, ...]
   * @param {boolean} visible 是否显示
   */
  update(handList, visible = true) {
    if (!this.renderer) return;

    if (!visible || !handList || handList.length === 0) {
      this.hands.Right.group.visible = false;
      this.hands.Left.group.visible = false;
      this.renderer.clear(true, true, true);
      return;
    }

    const activeSides = { Right: false, Left: false };

    try {
      handList.forEach((handData, idx) => {
        const side = handData.handedness?.toLowerCase() === 'left' || idx === 1 ? 'Left' : 'Right';
        const landmarks = handData.rawLandmarks;
        if (!landmarks || landmarks.length < 21) return;

        activeSides[side] = true;
        const hand = this.hands[side];
        hand.group.visible = true;

        // 归一化点映射到屏幕世界空间
        const rawPts3D = this._mapLandmarksToWorld(landmarks);

        // 自适应动态指数滤波 (Adaptive EMA)
        // 缓慢微动时使用高阻尼消除噪点微抖，快速滑动时自适应提高响应率
        if (!hand.smoothedPts || hand.smoothedPts.length !== rawPts3D.length) {
          hand.smoothedPts = rawPts3D.map((p) => ({ ...p }));
        } else {
          for (let i = 0; i < rawPts3D.length; i++) {
            const dx = rawPts3D[i].x - hand.smoothedPts[i].x;
            const dy = rawPts3D[i].y - hand.smoothedPts[i].y;
            const dz = rawPts3D[i].z - hand.smoothedPts[i].z;
            const moveDist = Math.hypot(dx, dy, dz);

            // 速度自适应平滑系数
            const alpha = Math.min(0.75, Math.max(0.32, moveDist * 0.05));
            hand.smoothedPts[i].x += dx * alpha;
            hand.smoothedPts[i].y += dy * alpha;
            hand.smoothedPts[i].z += dz * alpha;
          }
        }
        const pts3D = hand.smoothedPts;

        if (this.currentTheme === 'model' && hand.gltfModel && this.modelLoadState[side] === 'loaded') {
          this._driveGltfHand(hand, pts3D, landmarks);
          hand.gltfWrapper.visible = true;
          this._setAnatomicalVisible(hand, false);
        } else {
          hand.gltfWrapper.visible = false;
          this._setAnatomicalVisible(hand, true);
          this._driveAnatomicalHand(hand, pts3D, handData);
        }
      });

      if (!activeSides.Right) {
        this.hands.Right.group.visible = false;
        this.hands.Right.smoothedPts = null;
      }
      if (!activeSides.Left) {
        this.hands.Left.group.visible = false;
        this.hands.Left.smoothedPts = null;
      }

      this.renderer.render(this.scene, this.camera);
    } catch (renderErr) {
      console.warn('3D 手势渲染保护:', renderErr);
    }
  }

  _setAnatomicalVisible(hand, visible) {
    hand.palmMesh.visible = visible;
    hand.wristMesh.visible = visible;
    hand.shadowMesh.visible = visible;
    if (!visible) {
      if (hand.pinchHaloMesh) hand.pinchHaloMesh.visible = false;
      if (hand.eraserMesh) hand.eraserMesh.visible = false;
    }
    hand.fingers.forEach((f) => {
      f.knuckles.forEach((k) => (k.mesh.visible = visible));
      f.segments.forEach((s) => (s.mesh.visible = visible));
      if (f.nailMesh) f.nailMesh.visible = visible;
    });
  }

  _mapLandmarksToWorld(landmarks) {
    const w = this.width;
    const h = this.height;
    const dx = (landmarks[5].x - landmarks[17].x) * w;
    const dy = (landmarks[5].y - landmarks[17].y) * h;
    const palmScale = Math.hypot(dx, dy) || 120;

    return landmarks.map((pt) => ({
      x: (1 - pt.x) * w,
      y: pt.y * h,
      z: -pt.z * palmScale * 2.2,
    }));
  }

  // ═══════════════════════════════════════════════════════
  //  驱动 3D 拟真解剖学手模 (Anatomical Hand)
  // ═══════════════════════════════════════════════════════

  _driveAnatomicalHand(hand, pts, handData = null) {
    const palmBaseScale = Math.hypot(pts[5].x - pts[17].x, pts[5].y - pts[17].y) || 100;
    const thickness = palmBaseScale * 0.17;

    // 1. 计算 3D 手掌法向量 (掌心朝向 / 手背朝向)
    const v1 = new THREE.Vector3(pts[5].x - pts[0].x, pts[5].y - pts[0].y, pts[5].z - pts[0].z);
    const v2 = new THREE.Vector3(pts[17].x - pts[0].x, pts[17].y - pts[0].y, pts[17].z - pts[0].z);
    const palmNormal = new THREE.Vector3().crossVectors(v1, v2).normalize();

    // 根据左右手校准手背朝向方向
    const isRightHand = hand.handedness.toLowerCase() === 'right';
    const dorsalNormal = isRightHand ? palmNormal.clone().negate() : palmNormal.clone();

    // 2. 更新解剖学有机手掌网格 (含大鱼际肌、小鱼际肌与指蹼连贯曲面)
    this._updatePalmGeometry(hand.palmMesh, pts, thickness, dorsalNormal, hand.handedness);

    // 3. 更新手腕基座袖套 (Wrist Cuff)
    const wristPt = pts[0];
    const midMCP = new THREE.Vector3(
      (pts[5].x + pts[17].x) * 0.5,
      (pts[5].y + pts[17].y) * 0.5,
      (pts[5].z + pts[17].z) * 0.5
    );
    const wristDir = new THREE.Vector3(
      midMCP.x - wristPt.x,
      midMCP.y - wristPt.y,
      midMCP.z - wristPt.z
    ).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, wristDir);

    const wristRadius = palmBaseScale * 0.15;
    const wristLength = palmBaseScale * 0.22;
    // 腕部略向小臂延伸
    const wristPos = new THREE.Vector3(
      wristPt.x - wristDir.x * wristLength * 0.4,
      wristPt.y - wristDir.y * wristLength * 0.4,
      wristPt.z - wristDir.z * wristLength * 0.4
    );
    hand.wristMesh.position.copy(wristPos);
    hand.wristMesh.quaternion.copy(quat);
    hand.wristMesh.scale.set(wristRadius, wristLength, wristRadius * 0.85);

    // 4. 更新五指：有机无缝指节 + 掌指关节 + 3D 立体曲面指甲盖
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const segDir = new THREE.Vector3();

    hand.fingers.forEach((finger) => {
      // (a) 更新掌指关节微隆起 (Knuckles)
      finger.knuckles.forEach((k) => {
        const pt = pts[k.index];
        k.mesh.position.set(pt.x, pt.y, pt.z);
        const radius = k.isTip ? palmBaseScale * 0.082 : palmBaseScale * 0.098;
        k.mesh.scale.set(radius, radius, radius);
      });

      // (b) 更新平滑指节 (连接两关节点，同心球形顶底零缝隙贴合)
      finger.segments.forEach((seg) => {
        const fromPt = pts[seg.from];
        const toPt = pts[seg.to];
        p1.set(fromPt.x, fromPt.y, fromPt.z);
        p2.set(toPt.x, toPt.y, toPt.z);

        const length = p1.distanceTo(p2);
        if (length < 0.001) return;

        // 原点位于 fromPt
        seg.mesh.position.copy(p1);

        segDir.subVectors(p2, p1).normalize();
        quat.setFromUnitVectors(up, segDir);
        seg.mesh.quaternion.copy(quat);

        // 指节粗细近端稍粗，远端稍细
        const r = palmBaseScale * (0.096 - seg.stage * 0.012);
        seg.mesh.scale.set(r, length, r);
      });

      // (c) 更新 3D 立体曲面指甲盖 (位于末节指背)
      if (finger.nailMesh) {
        const tipIdx = finger.joints[finger.joints.length - 1];
        const dipIdx = finger.joints[finger.joints.length - 2];
        const tipPt = pts[tipIdx];
        const dipPt = pts[dipIdx];

        p1.set(dipPt.x, dipPt.y, dipPt.z);
        p2.set(tipPt.x, tipPt.y, tipPt.z);

        segDir.subVectors(p2, p1).normalize();
        const segLen = p1.distanceTo(p2);

        quat.setFromUnitVectors(up, segDir);
        finger.nailMesh.quaternion.copy(quat);

        // 顺着指骨背向法线自然贴合在甲床表面
        const nailWidth = palmBaseScale * 0.082 * finger.nailScale;
        const nailLength = Math.max(12, segLen * 0.42);

        // 位置位于指尖稍靠后
        const nailPos = p2.clone().addScaledVector(segDir, -nailLength * 0.78);
        // 沿手背法向贴合指面
        nailPos.addScaledVector(dorsalNormal, nailWidth * 0.72);

        finger.nailMesh.position.copy(nailPos);
        finger.nailMesh.scale.set(nailWidth, nailLength, nailWidth * 0.95);
      }
    });

    // 5. 悬浮接触柔和暗影
    if (hand.shadowMesh) {
      const pWrist = pts[0];
      const pMiddle = pts[9];
      const palmCenterX = (pWrist.x + pMiddle.x) * 0.5;
      const palmCenterY = (pWrist.y + pMiddle.y) * 0.5;
      const palmCenterZ = (pWrist.z + pMiddle.z) * 0.5;

      hand.shadowMesh.position.set(palmCenterX, palmCenterY + palmBaseScale * 0.12, -100);
      const depthFactor = Math.max(0.6, Math.min(2.0, 1.0 + (palmCenterZ / palmBaseScale) * 0.4));
      const shadowRadius = palmBaseScale * 0.88 * depthFactor;
      hand.shadowMesh.scale.set(shadowRadius, shadowRadius * 0.76, 1);
      hand.shadowMesh.material.opacity = Math.max(0.06, Math.min(0.22, 0.18 - (palmCenterZ / palmBaseScale) * 0.08));
    }

    // 6. 捏合作画高光微光环 (Pinch Halo Feedback)
    if (hand.pinchHaloMesh) {
      const thumbTip = pts[4];
      const indexTip = pts[8];
      const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y, thumbTip.z - indexTip.z);
      const pinchThreshold = palmBaseScale * 0.32;

      if (pinchDist < pinchThreshold) {
        hand.pinchHaloMesh.visible = true;
        const midX = (thumbTip.x + indexTip.x) * 0.5;
        const midY = (thumbTip.y + indexTip.y) * 0.5;
        const midZ = Math.max(thumbTip.z, indexTip.z) + 12;
        hand.pinchHaloMesh.position.set(midX, midY, midZ);
        const ringScale = Math.max(10, palmBaseScale * 0.17 * (1.12 - pinchDist / pinchThreshold));
        hand.pinchHaloMesh.scale.set(ringScale, ringScale, 1);
      } else {
        hand.pinchHaloMesh.visible = false;
      }
    }

    // 7. 橡皮擦范围指示环 (Eraser Field Feedback)
    if (hand.eraserMesh) {
      const isPalmOpen = handData?.classification?.isOpenPalm && handData?.classification?.isPalm;
      if (isPalmOpen) {
        hand.eraserMesh.visible = true;
        const pWrist = pts[0];
        const pMiddle = pts[9];
        const cx = (pWrist.x + pMiddle.x) * 0.5;
        const cy = (pWrist.y + pMiddle.y) * 0.5;
        const cz = (pWrist.z + pMiddle.z) * 0.5 + 8;
        hand.eraserMesh.position.set(cx, cy, cz);
        const radius = handData.eraserRadius || palmBaseScale * 0.55;
        hand.eraserMesh.scale.set(radius, radius, 1);
      } else {
        hand.eraserMesh.visible = false;
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  //  更新解剖学有机 3D 手掌网格 (含大鱼际肌、掌弓与指蹼过渡)
  // ═══════════════════════════════════════════════════════

  _updatePalmGeometry(mesh, pts, thickness, dorsalNormal, handedness) {
    const pos = mesh.geometry.attributes.position.array;
    const isRightHand = handedness.toLowerCase() === 'right';

    // 核心掌骨关键点
    const pWrist = pts[0];
    const pThumbCMC = pts[1];
    const pThumbMCP = pts[2];
    const pIndexMCP = pts[5];
    const pMiddleMCP = pts[9];
    const pRingMCP = pts[13];
    const pPinkyMCP = pts[17];

    // 计算手掌关键特征向量
    const normal = dorsalNormal;

    // 顶端指蹼与掌指关节横行控制点 (7列)：
    // 从拇指外缘 -> 虎口指蹼 -> 食指根 -> 食中指蹼 -> 中指根 -> 中无名指蹼 -> 小指根
    const knuckleRow = [
      pThumbMCP,
      // 虎口指蹼 (自然柔和曲线过渡)
      {
        x: pThumbMCP.x * 0.45 + pIndexMCP.x * 0.55,
        y: pThumbMCP.y * 0.45 + pIndexMCP.y * 0.55,
        z: pThumbMCP.z * 0.45 + pIndexMCP.z * 0.55,
      },
      pIndexMCP,
      // 食中指蹼
      {
        x: (pIndexMCP.x + pMiddleMCP.x) * 0.5,
        y: (pIndexMCP.y + pMiddleMCP.y) * 0.5,
        z: (pIndexMCP.z + pMiddleMCP.z) * 0.5,
      },
      pMiddleMCP,
      // 中无名指蹼
      {
        x: (pMiddleMCP.x + pRingMCP.x) * 0.5,
        y: (pMiddleMCP.y + pRingMCP.y) * 0.5,
        z: (pMiddleMCP.z + pRingMCP.z) * 0.5,
      },
      pPinkyMCP,
    ];

    // 底部手腕横行控制点 (7列)
    const wristRadial = {
      x: pWrist.x + (pIndexMCP.x - pPinkyMCP.x) * 0.28,
      y: pWrist.y + (pIndexMCP.y - pPinkyMCP.y) * 0.28,
      z: pWrist.z,
    };
    const wristUlnar = {
      x: pWrist.x - (pIndexMCP.x - pPinkyMCP.x) * 0.25,
      y: pWrist.y - (pIndexMCP.y - pPinkyMCP.y) * 0.25,
      z: pWrist.z,
    };

    const wristRow = [];
    for (let c = 0; c < 7; c++) {
      const t = c / 6;
      wristRow.push({
        x: wristRadial.x * (1 - t) + wristUlnar.x * t,
        y: wristRadial.y * (1 - t) + wristUlnar.y * t,
        z: wristRadial.z * (1 - t) + wristUlnar.z * t,
      });
    }

    const rows = 5;
    const cols = 7;
    const numSurface = rows * cols;

    for (let r = 0; r < rows; r++) {
      const v = r / (rows - 1); // 0 (手腕) 到 1 (指根)

      for (let c = 0; c < cols; c++) {
        const u = c / (cols - 1); // 0 (拇指侧) 到 1 (小指侧)
        const basePoint = {
          x: wristRow[c].x * (1 - v) + knuckleRow[c].x * v,
          y: wristRow[c].y * (1 - v) + knuckleRow[c].y * v,
          z: wristRow[c].z * (1 - v) + knuckleRow[c].z * v,
        };

        // 解剖学肌肉丰满度偏移 (Thenar & Hypothenar Eminence)：
        // 1. 大鱼际肌 (Thenar) 位于拇指侧中下部 (u < 0.35, 0.25 < v < 0.75)
        const thenarDist = Math.hypot((u - 0.18) * 2.2, (v - 0.48) * 1.8);
        const thenarBulge = Math.max(0, 1.0 - thenarDist) * 1.45;

        // 2. 小鱼际肌 (Hypothenar) 位于小指侧中下部 (u > 0.65, 0.2 < v < 0.65)
        const hypoDist = Math.hypot((u - 0.85) * 2.2, (v - 0.42) * 1.8);
        const hypoBulge = Math.max(0, 1.0 - hypoDist) * 1.15;

        // 3. 掌心自然凹陷 (Palmar Hollow)
        const hollowDist = Math.hypot((u - 0.5) * 2.5, (v - 0.5) * 2.0);
        const hollowDepth = Math.max(0, 1.0 - hollowDist) * 0.45;

        // 4. 手背肌腱自然纵向起伏
        const tendonRidge = Math.sin(u * Math.PI * 4) * 0.12 * Math.sin(v * Math.PI);

        // 手背表面顶点 (Dorsal: 顺着 dorsalNormal 隆起)
        const dorsalThick = thickness * (0.48 + tendonRidge);
        const topIdx = (r * cols + c) * 3;
        pos[topIdx + 0] = basePoint.x + normal.x * dorsalThick;
        pos[topIdx + 1] = basePoint.y + normal.y * dorsalThick;
        pos[topIdx + 2] = basePoint.z + normal.z * dorsalThick;

        // 手心表面顶点 (Palmar: 沿 -dorsalNormal 延展，包含丰满大鱼际与掌心凹陷)
        const palmarThick = thickness * (0.52 + thenarBulge + hypoBulge - hollowDepth);
        const botIdx = (numSurface + r * cols + c) * 3;
        pos[botIdx + 0] = basePoint.x - normal.x * palmarThick;
        pos[botIdx + 1] = basePoint.y - normal.y * palmarThick;
        pos[botIdx + 2] = basePoint.z - normal.z * palmarThick;
      }
    }

    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  // ═══════════════════════════════════════════════════════
  //  驱动开源 GLTF 模型 (WebXR Generic Hand)
  // ═══════════════════════════════════════════════════════

  _driveGltfHand(hand, pts, rawLandmarks) {
    const root = hand.gltfModel;
    if (!root) return;

    const wrist = pts[0];
    root.position.set(wrist.x, wrist.y, wrist.z);

    const palmDist = Math.hypot(pts[5].x - pts[17].x, pts[5].y - pts[17].y);
    const scale = (palmDist / 85) * 8.5;
    root.scale.set(scale, scale, scale);

    if (hand.gltfBones?.length > 0) {
      const mpToBoneMap = [
        0,
        1, 2, 3, 4,
        5, 6, 7, 8,
        9, 10, 11, 12,
        13, 14, 15, 16,
        17, 18, 19, 20,
      ];

      mpToBoneMap.forEach((mpIdx, bIdx) => {
        const bone = hand.gltfBones[bIdx];
        if (bone && pts[mpIdx]) {
          const pt = pts[mpIdx];
          bone.position.set(
            (pt.x - wrist.x) / scale,
            (pt.y - wrist.y) / scale,
            (pt.z - wrist.z) / scale
          );
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════
  //  样式与模式切换
  // ═══════════════════════════════════════════════════════

  /**
   * 切换 3D 手模渲染风格
   * @param {'skin' | 'cyber' | 'model'} themeName
   */
  setTheme(themeName) {
    if (this.currentTheme === themeName) return;
    this.currentTheme = themeName;

    const matSet = this.materials[themeName] || this.materials.skin;

    ['Right', 'Left'].forEach((side) => {
      const hand = this.hands[side];
      if (!hand) return;

      hand.palmMesh.material = matSet.palm;
      hand.wristMesh.material = matSet.wrist || matSet.joint;

      hand.fingers.forEach((finger) => {
        finger.knuckles.forEach((k) => (k.mesh.material = matSet.joint));
        finger.segments.forEach((s) => (s.mesh.material = matSet.finger));
        if (finger.nailMesh) finger.nailMesh.material = matSet.nail;
      });
    });
  }

  resize(w, h) {
    this.width = w;
    this.height = h;

    if (this.camera) {
      this.camera.right = w;
      this.camera.bottom = h;
      this.camera.updateProjectionMatrix();
    }

    if (this.renderer) {
      this.renderer.setSize(w, h);
    }
  }

  destroy() {
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
  }
}
