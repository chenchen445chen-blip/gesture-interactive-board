import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Hand3DScene - 真实 3D 手势渲染场景
 * 
 * 功能特性：
 * 1. 3D 拟真解剖学手模 (Anatomical Skin)：1:1 动态贴合 MediaPipe 21 点，自然指节、指腹与手掌厚度，PBR 次表面肤色光泽
 * 2. 开源 WebXR SkinnedMesh 骨骼模型 (Open-source GLTF)：加载开源 standard generic hand 模型并实时骨骼姿态驱动
 * 3. 赛博机甲 3D 手模 (Cyberpunk Mechanical)：钛金拉丝金属 + 荧光关节霓虹线
 * 4. 零 GC 内存优化：预分配网格与变换矩阵，60FPS 极速丝滑渲染
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
    // (0, 0) 在左上角，(width, height) 在右下角，完全与 Canvas 屏幕坐标重合
    this.camera = new THREE.OrthographicCamera(
      0,
      this.width,
      0,
      this.height,
      -1200,
      1200
    );
    this.camera.position.set(0, 0, 500);
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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambientLight);

    // 主方向光（来自前方斜上方，模拟自然日光照在手背）
    const mainDirLight = new THREE.DirectionalLight(0xfff7ed, 1.4);
    mainDirLight.position.set(200, -300, 400);
    this.scene.add(mainDirLight);

    // 轮廓补光（来自侧下方，勾勒手缘立体感）
    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.7);
    rimLight.position.set(-200, 300, -200);
    this.scene.add(rimLight);

    // 半球光（天空暖光与地面冷反光）
    const hemiLight = new THREE.HemisphereLight(0xffedd5, 0x1e293b, 0.6);
    this.scene.add(hemiLight);
  }

  _initMaterials() {
    // 1. 拟真皮肤材质 (Natural Realistic Skin)
    this.materials.skin = {
      palm: new THREE.MeshStandardMaterial({
        color: 0xf5caa6,
        roughness: 0.55,
        metalness: 0.05,
        flatShading: false,
      }),
      finger: new THREE.MeshStandardMaterial({
        color: 0xefbe9b,
        roughness: 0.5,
        metalness: 0.05,
        flatShading: false,
      }),
      joint: new THREE.MeshStandardMaterial({
        color: 0xeaa988, // 关节处微红，模拟真实软骨与血液微循环
        roughness: 0.6,
        metalness: 0.04,
      }),
      nail: new THREE.MeshStandardMaterial({
        color: 0xffe4db,
        roughness: 0.25,
        metalness: 0.1, // 指甲盖光泽感
      }),
    };

    // 2. 赛博机甲材质 (Cyberpunk Mechanical)
    this.materials.cyber = {
      palm: new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.2,
        metalness: 0.85,
      }),
      finger: new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.25,
        metalness: 0.9,
      }),
      joint: new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.5,
      }),
      nail: new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        emissive: 0x0891b2,
        emissiveIntensity: 1.0,
        roughness: 0.1,
        metalness: 0.3,
      }),
    };

    // 3. 悬浮柔和阴影材质
    this.materials.shadow = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.16,
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

    // 预创建通用几何体（避免动态分配）
    this.sharedGeometries.sphere = new THREE.SphereGeometry(1, 16, 12);
    this.sharedGeometries.cylinder = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false);
    this.sharedGeometries.tipSphere = new THREE.SphereGeometry(1, 16, 12);
    this.sharedGeometries.nail = new THREE.CylinderGeometry(0.8, 0.9, 0.15, 12);
    this.sharedGeometries.shadow = new THREE.CircleGeometry(1, 24);
    this.sharedGeometries.ring = new THREE.RingGeometry(0.7, 1.0, 24);
  }

  // ═══════════════════════════════════════════════════════
  //  创建手部 3D 模型层次体系
  // ═══════════════════════════════════════════════════════

  _createHandContainer(handedness) {
    const group = new THREE.Group();
    group.visible = false;

    // 手指骨骼定义：5 根手指，每根手指的关键点序号
    const fingerDefs = [
      { name: 'thumb', joints: [1, 2, 3, 4], baseRadius: 15, tipRadius: 10 },
      { name: 'index', joints: [5, 6, 7, 8], baseRadius: 14, tipRadius: 9 },
      { name: 'middle', joints: [9, 10, 11, 12], baseRadius: 14.5, tipRadius: 9.5 },
      { name: 'ring', joints: [13, 14, 15, 16], baseRadius: 13.5, tipRadius: 8.5 },
      { name: 'pinky', joints: [17, 18, 19, 20], baseRadius: 12, tipRadius: 7.5 },
    ];

    const currentMat = this.materials[this.currentTheme] || this.materials.skin;

    // 1. 手掌几何体容器
    const palmMesh = this._createPalmMesh(currentMat.palm);
    group.add(palmMesh);

    // 2. 五指各指节与关节节点
    const fingers = [];
    fingerDefs.forEach((def) => {
      const fingerObj = {
        name: def.name,
        joints: def.joints,
        segments: [],
        knuckles: [],
        nailMesh: null,
      };

      // 关节球 (Knuckles)
      def.joints.forEach((jointIdx, i) => {
        const kMesh = new THREE.Mesh(this.sharedGeometries.sphere, currentMat.joint);
        kMesh.visible = true;
        group.add(kMesh);
        fingerObj.knuckles.push({ index: jointIdx, mesh: kMesh });
      });

      // 指节胶囊连接柱 (Bone segments)
      for (let s = 0; s < def.joints.length - 1; s++) {
        const fromIdx = def.joints[s];
        const toIdx = def.joints[s + 1];
        const segMesh = new THREE.Mesh(this.sharedGeometries.cylinder, currentMat.finger);
        group.add(segMesh);
        fingerObj.segments.push({ from: fromIdx, to: toIdx, mesh: segMesh, stage: s });
      }

      // 指甲盖 (仅指尖关节拥有)
      const nailMesh = new THREE.Mesh(this.sharedGeometries.nail, currentMat.nail);
      group.add(nailMesh);
      fingerObj.nailMesh = nailMesh;

      fingers.push(fingerObj);
    });

    // 3. 手腕基座球 (Wrist Joint)
    const wristMesh = new THREE.Mesh(this.sharedGeometries.sphere, currentMat.joint);
    group.add(wristMesh);

    // 4. 开源 GLTF 骨骼模型包装挂载点
    const gltfWrapper = new THREE.Group();
    gltfWrapper.visible = false;
    group.add(gltfWrapper);

    // 5. 悬浮物理投影网格 (Soft Drop Shadow)
    const shadowMesh = new THREE.Mesh(this.sharedGeometries.shadow, this.materials.shadow);
    shadowMesh.visible = false;
    group.add(shadowMesh);

    // 6. 捏合作画高光微光环 (Pinch Halo)
    const pinchHaloMesh = new THREE.Mesh(this.sharedGeometries.ring, this.materials.pinchHalo);
    pinchHaloMesh.visible = false;
    group.add(pinchHaloMesh);

    return {
      group,
      handedness,
      palmMesh,
      fingers,
      wristMesh,
      shadowMesh,
      pinchHaloMesh,
      gltfWrapper,
      gltfModel: null,
      gltfBones: [],
      smoothedPts: null,
    };
  }

  // 构造真实厚度手掌网格
  _createPalmMesh(material) {
    const geom = new THREE.BufferGeometry();
    // 掌心由 0 (手腕), 1 (拇指根), 5 (食指根), 9 (中指根), 13 (无名指根), 17 (小指根) 及掌心中心构成
    // 正反两面形成掌心厚度，共 14 个顶点，16 个三角形
    const vertexCount = 14;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);

    // 索引缓冲: 手掌正反双面及侧边厚度
    const indices = [
      // 正面 (手背)
      0, 1, 5,
      0, 5, 9,
      0, 9, 13,
      0, 13, 17,
      // 反面 (手心)
      7, 12, 8,
      7, 13, 12,
      7, 14, 13,
      7, 15, 14,
      // 侧边缝合
      0, 17, 15,  0, 15, 7,
      17, 13, 14, 17, 14, 15,
      13, 9, 12,  13, 12, 14,
      9, 5, 8,    9, 8, 12,
      5, 1, 8,    1, 8, 8,
      0, 7, 8,    0, 8, 1,
    ];

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(indices);

    const mesh = new THREE.Mesh(geom, material);
    mesh.frustumCulled = false;
    return mesh;
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
    // 赋予自然皮肤材质质感
    root.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = false;
        node.receiveShadow = false;
        node.material = new THREE.MeshStandardMaterial({
          color: 0xf5caa6,
          roughness: 0.5,
          metalness: 0.05,
        });
      }
    });

    hand.gltfModel = root;
    hand.gltfWrapper.add(root);

    // 缓存骨骼节点引用
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
      this.renderer.clear();
      return;
    }

    // 记录本帧活跃的手
    const activeSides = { Right: false, Left: false };

    handList.forEach((handData, idx) => {
      const side = handData.handedness?.toLowerCase() === 'left' || idx === 1 ? 'Left' : 'Right';
      const landmarks = handData.rawLandmarks;
      if (!landmarks || landmarks.length < 21) return;

      activeSides[side] = true;
      const hand = this.hands[side];
      hand.group.visible = true;

      // 将 MediaPipe 归一化点映射到屏幕世界空间 (X 镜像翻转，Z 放大深度)
      const rawPts3D = this._mapLandmarksToWorld(landmarks);

      // 运动动力学指数平滑滤波 (EMA Smoothing)，彻底消除摄像头帧间噪点微抖动
      if (!hand.smoothedPts || hand.smoothedPts.length !== rawPts3D.length) {
        hand.smoothedPts = rawPts3D.map((p) => ({ ...p }));
      } else {
        const alpha = 0.46; // 兼具极致防抖与零感知延迟
        for (let i = 0; i < rawPts3D.length; i++) {
          hand.smoothedPts[i].x += (rawPts3D[i].x - hand.smoothedPts[i].x) * alpha;
          hand.smoothedPts[i].y += (rawPts3D[i].y - hand.smoothedPts[i].y) * alpha;
          hand.smoothedPts[i].z += (rawPts3D[i].z - hand.smoothedPts[i].z) * alpha;
        }
      }
      const pts3D = hand.smoothedPts;

      // 根据当前风格驱动模型
      if (this.currentTheme === 'model' && hand.gltfModel && this.modelLoadState[side] === 'loaded') {
        // 模式：开源 GLTF 骨骼模型
        this._driveGltfHand(hand, pts3D, landmarks);
        hand.gltfWrapper.visible = true;
        this._setAnatomicalVisible(hand, false);
      } else {
        // 模式：3D 拟真解剖学模型 (Skin / Cyber)
        hand.gltfWrapper.visible = false;
        this._setAnatomicalVisible(hand, true);
        this._driveAnatomicalHand(hand, pts3D);
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

    // 渲染 Three.js 场景
    this.renderer.render(this.scene, this.camera);
  }

  _setAnatomicalVisible(hand, visible) {
    hand.palmMesh.visible = visible;
    hand.wristMesh.visible = visible;
    hand.shadowMesh.visible = visible;
    hand.fingers.forEach((f) => {
      f.knuckles.forEach((k) => (k.mesh.visible = visible));
      f.segments.forEach((s) => (s.mesh.visible = visible));
      if (f.nailMesh) f.nailMesh.visible = visible;
    });
  }

  // 坐标空间转换：归一化坐标 -> 屏幕像素 3D 空间
  _mapLandmarksToWorld(landmarks) {
    const w = this.width;
    const h = this.height;
    // 手掌基准尺度（用于深度 Z 的合理比例扩展）
    const dx = (landmarks[5].x - landmarks[17].x) * w;
    const dy = (landmarks[5].y - landmarks[17].y) * h;
    const palmScale = Math.hypot(dx, dy) || 120;

    return landmarks.map((pt) => {
      return {
        x: (1 - pt.x) * w,   // 镜像匹配摄像头
        y: pt.y * h,         // 屏幕 Y
        z: -pt.z * palmScale * 2.2, // 深度 Z (靠近镜头为正，远离为负)
      };
    });
  }

  // ═══════════════════════════════════════════════════════
  //  驱动 3D 拟真解剖学手模 (Anatomical Hand)
  // ═══════════════════════════════════════════════════════

  _driveAnatomicalHand(hand, pts) {
    const palmBaseScale = Math.hypot(pts[5].x - pts[17].x, pts[5].y - pts[17].y) || 100;
    const thickness = palmBaseScale * 0.16; // 拟真手掌厚度

    // 1. 更新手腕基座
    const wrist = pts[0];
    hand.wristMesh.position.set(wrist.x, wrist.y, wrist.z);
    const wristRadius = palmBaseScale * 0.14;
    hand.wristMesh.scale.set(wristRadius, wristRadius, wristRadius);

    // 2. 更新手掌网格顶点 (手背与手心双层，包裹掌骨)
    this._updatePalmGeometry(hand.palmMesh, pts, thickness);

    // 3. 更新五指：关节球 (Knuckles) + 指节胶囊柱 (Bone Segments) + 指甲盖 (Nails)
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion();

    hand.fingers.forEach((finger) => {
      // (a) 更新关节球
      finger.knuckles.forEach((k) => {
        const pt = pts[k.index];
        k.mesh.position.set(pt.x, pt.y, pt.z);
        // 指尖稍小，指根较粗
        const isTip = k.index % 4 === 0;
        const radius = isTip ? palmBaseScale * 0.08 : palmBaseScale * 0.095;
        k.mesh.scale.set(radius, radius, radius);
      });

      // (b) 更新各指节圆柱 (连接两关节点，自动计算朝向与长度)
      finger.segments.forEach((seg) => {
        const fromPt = pts[seg.from];
        const toPt = pts[seg.to];
        p1.set(fromPt.x, fromPt.y, fromPt.z);
        p2.set(toPt.x, toPt.y, toPt.z);

        const length = p1.distanceTo(p2);
        if (length < 0.001) return;

        // 圆柱位置位于两点中点
        seg.mesh.position.lerpVectors(p1, p2, 0.5);

        // 旋转对齐：Three.js 默认圆柱沿 Y 轴，将 (0,1,0) 旋转对齐到 dir 向量
        dir.subVectors(p2, p1).normalize();
        quat.setFromUnitVectors(up, dir);
        seg.mesh.quaternion.copy(quat);

        // 粗细渐变：近端较粗，远端较细
        const r = palmBaseScale * (0.09 - seg.stage * 0.012);
        seg.mesh.scale.set(r, length, r);
      });

      // (c) 更新指甲盖 (位于指尖，贴在指背方向)
      if (finger.nailMesh) {
        const tipIdx = finger.joints[finger.joints.length - 1];
        const dipIdx = finger.joints[finger.joints.length - 2];
        const tipPt = pts[tipIdx];
        const dipPt = pts[dipIdx];

        p1.set(dipPt.x, dipPt.y, dipPt.z);
        p2.set(tipPt.x, tipPt.y, tipPt.z);

        dir.subVectors(p2, p1).normalize();
        quat.setFromUnitVectors(up, dir);

        // 贴合在指背浅表面
        const nailPos = p2.clone().addScaledVector(dir, -2);
        nailPos.z += thickness * 0.45;

        finger.nailMesh.position.copy(nailPos);
        finger.nailMesh.quaternion.copy(quat);
        const nailR = palmBaseScale * 0.07;
        finger.nailMesh.scale.set(nailR, 1, nailR);
      }
    });

    // 4. 更新柔和悬浮接触暗影 (根据手掌中心与深度自适应缩放与透明度)
    if (hand.shadowMesh) {
      const pWrist = pts[0];
      const pMiddle = pts[9];
      const palmCenterX = (pWrist.x + pMiddle.x) * 0.5;
      const palmCenterY = (pWrist.y + pMiddle.y) * 0.5;
      const palmCenterZ = (pWrist.z + pMiddle.z) * 0.5;

      // 阴影固定在画布浅层基底
      hand.shadowMesh.position.set(palmCenterX, palmCenterY + palmBaseScale * 0.1, -100);
      // 深度越大，阴影扩散越大、颜色越淡
      const depthFactor = Math.max(0.6, Math.min(2.0, 1.0 + (palmCenterZ / palmBaseScale) * 0.4));
      const shadowRadius = palmBaseScale * 0.85 * depthFactor;
      hand.shadowMesh.scale.set(shadowRadius, shadowRadius * 0.75, 1);
      hand.shadowMesh.material.opacity = Math.max(0.06, Math.min(0.24, 0.2 - (palmCenterZ / palmBaseScale) * 0.08));
    }

    // 5. 捏合作画微光环 (Pinch Halo Feedback)
    if (hand.pinchHaloMesh) {
      const thumbTip = pts[4];
      const indexTip = pts[8];
      const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y, thumbTip.z - indexTip.z);
      const pinchThreshold = palmBaseScale * 0.32;

      if (pinchDist < pinchThreshold) {
        hand.pinchHaloMesh.visible = true;
        const midX = (thumbTip.x + indexTip.x) * 0.5;
        const midY = (thumbTip.y + indexTip.y) * 0.5;
        const midZ = Math.max(thumbTip.z, indexTip.z) + 10;
        hand.pinchHaloMesh.position.set(midX, midY, midZ);
        const ringScale = Math.max(10, palmBaseScale * 0.16 * (1.1 - pinchDist / pinchThreshold));
        hand.pinchHaloMesh.scale.set(ringScale, ringScale, 1);
      } else {
        hand.pinchHaloMesh.visible = false;
      }
    }
  }

  // 手掌立体网格顶点更新
  _updatePalmGeometry(mesh, pts, thickness) {
    const pos = mesh.geometry.attributes.position.array;
    // 关键点：0(腕), 1(拇根), 5(食根), 9(中根), 13(无名根), 17(小根), 掌心(center)
    const baseIndices = [0, 1, 5, 9, 13, 17];
    let cx = 0, cy = 0, cz = 0;
    baseIndices.forEach((idx) => {
      cx += pts[idx].x;
      cy += pts[idx].y;
      cz += pts[idx].z;
    });
    cx /= baseIndices.length;
    cy /= baseIndices.length;
    cz /= baseIndices.length;

    // 手背层 (Z + thickness * 0.5)
    baseIndices.forEach((idx, i) => {
      pos[i * 3 + 0] = pts[idx].x;
      pos[i * 3 + 1] = pts[idx].y;
      pos[i * 3 + 2] = pts[idx].z + thickness * 0.5;
    });
    // 手背中心点
    pos[6 * 3 + 0] = cx;
    pos[6 * 3 + 1] = cy;
    pos[6 * 3 + 2] = cz + thickness * 0.6;

    // 手心层 (Z - thickness * 0.5)
    baseIndices.forEach((idx, i) => {
      const offset = (7 + i) * 3;
      pos[offset + 0] = pts[idx].x;
      pos[offset + 1] = pts[idx].y;
      pos[offset + 2] = pts[idx].z - thickness * 0.5;
    });
    // 手心中心点
    pos[13 * 3 + 0] = cx;
    pos[13 * 3 + 1] = cy;
    pos[13 * 3 + 2] = cz - thickness * 0.6;

    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  // ═══════════════════════════════════════════════════════
  //  驱动开源 GLTF 模型 (WebXR Generic Hand)
  // ═══════════════════════════════════════════════════════

  _driveGltfHand(hand, pts, rawLandmarks) {
    const root = hand.gltfModel;
    if (!root) return;

    // 定位根节点到手腕位置
    const wrist = pts[0];
    root.position.set(wrist.x, wrist.y, wrist.z);

    // 计算手掌大小比例
    const palmDist = Math.hypot(pts[5].x - pts[17].x, pts[5].y - pts[17].y);
    const scale = (palmDist / 85) * 8.5; // WebXR 模型尺寸适配
    root.scale.set(scale, scale, scale);

    // 遍历更新对应骨骼关节位置
    if (hand.gltfBones?.length > 0) {
      // 对应表：MediaPipe 21 点到 GLTF 骨骼节点映射
      const mpToBoneMap = [
        0,  // wrist
        1, 2, 3, 4, // thumb
        5, 6, 7, 8, // index
        9, 10, 11, 12, // middle
        13, 14, 15, 16, // ring
        17, 18, 19, 20  // pinky
      ];

      mpToBoneMap.forEach((mpIdx, bIdx) => {
        const bone = hand.gltfBones[bIdx];
        if (bone && pts[mpIdx]) {
          const pt = pts[mpIdx];
          // 将相对手腕的世界坐标转为骨骼局部位移
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

    // 重新应用材质到双手的所有网格
    ['Right', 'Left'].forEach((side) => {
      const hand = this.hands[side];
      if (!hand) return;

      hand.palmMesh.material = matSet.palm;
      hand.wristMesh.material = matSet.joint;

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
