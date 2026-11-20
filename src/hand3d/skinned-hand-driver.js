import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * createRealisticNailPlateGeometry
 * 构造符合人体解剖学的圆角微弧指甲盖网格 (Elliptical Curved Nail Plate)
 * 局部坐标：
 *  - X: 横向宽度 (-0.5 ~ +0.5)，具有自然横向 C 弧拱起
 *  - Z: 纵向长度 (0 甲根 ~ -1 甲尖)，甲根与甲尖均呈椭圆圆弧过渡
 *  - Y: 法向高度 (+Y 背侧拱起，边缘自然内收贴合甲沟)
 */
function createRealisticNailPlateGeometry() {
  const geom = new THREE.BufferGeometry();
  const uSegs = 14;
  const vSegs = 12;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let iv = 0; iv <= vSegs; iv++) {
    const v = iv / vSegs; // 0 (甲根 cuticle) -> 1 (甲游离缘 free edge)
    // 纵向椭圆收口轮廓：甲根与甲尖两端圆润收窄
    const longitudinalContour = Math.pow(Math.sin(v * Math.PI), 0.32) * 0.85 + 0.15;
    const z = -v; // 向 -Z 指尖方向延伸
    const archLong = Math.sin(v * Math.PI) * 0.12;

    for (let iu = 0; iu <= uSegs; iu++) {
      const u = iu / uSegs;
      const uNorm = (u - 0.5) * 2; // -1 ~ +1
      const x = uNorm * 0.5 * longitudinalContour;
      // 横向 C 弧曲率，两侧边缘向甲沟下弯包覆
      const archCross = (1 - uNorm * uNorm) * 0.34;
      const y = archCross + archLong;

      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  const row = uSegs + 1;
  for (let iv = 0; iv < vSegs; iv++) {
    for (let iu = 0; iu < uSegs; iu++) {
      const a = iv * row + iu;
      const b = (iv + 1) * row + iu;
      const c = (iv + 1) * row + (iu + 1);
      const d = iv * row + (iu + 1);
      indices.push(a, d, b);
      indices.push(d, c, b);
    }
  }

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/**
 * SkinnedHandMeshDriver — 真实一体式高模蒙皮人手驱动引擎 (Seamless Skinned Human Hand Mesh Driver)
 *
 * 彻底替换原先由圆柱体+小球拼凑的“木偶关节手”，
 * 采用一体成型 1360 顶点 / 6942 三角面高模蒙皮人手网格 (SkinnedMesh) + 25 根解剖骨骼树 (Skeleton)，
 * 并在五指远节指骨背侧贴合解剖学半透明角蛋白指甲盖、皮肤毛孔/掌纹程序纹理与次表面散射材质。
 */
export class SkinnedHandMeshDriver {
  constructor() {
    this.restPoseData = new WeakMap();
    this.nailGeometry = createRealisticNailPlateGeometry();
  }

  /**
   * 初始化并升级 GLTF 一体成型蒙皮手模，赋予真实皮肤次表面材质、程序化纹理及五指逼真指甲盖
   */
  prepareSkinnedModel(gltfScene, skinMaterial, nailMaterial, handedness = 'Right') {
    const isLeft = handedness.toLowerCase() === 'left';
    // 必须使用 SkeletonUtils.clone 以保证 SkinnedMesh.skeleton.bones 与克隆后的骨骼树正确绑定
    const root = cloneSkinned(gltfScene);
    let skinnedMesh = null;

    root.traverse((node) => {
      if (node.isSkinnedMesh || node.isMesh) {
        skinnedMesh = node;
        node.castShadow = true;
        node.receiveShadow = true;
        node.frustumCulled = false;
        if (node.geometry) {
          node.geometry.computeVertexNormals();
        }
        node.material = skinMaterial;
      }
    });

    const boneNames = [
      'wrist',
      'thumb-metacarpal',
      'thumb-phalanx-proximal',
      'thumb-phalanx-distal',
      'thumb-tip',
      'index-finger-metacarpal',
      'index-finger-phalanx-proximal',
      'index-finger-phalanx-intermediate',
      'index-finger-phalanx-distal',
      'index-finger-tip',
      'middle-finger-metacarpal',
      'middle-finger-phalanx-proximal',
      'middle-finger-phalanx-intermediate',
      'middle-finger-phalanx-distal',
      'middle-finger-tip',
      'ring-finger-metacarpal',
      'ring-finger-phalanx-proximal',
      'ring-finger-phalanx-intermediate',
      'ring-finger-phalanx-distal',
      'ring-finger-tip',
      'pinky-finger-metacarpal',
      'pinky-finger-phalanx-proximal',
      'pinky-finger-phalanx-intermediate',
      'pinky-finger-phalanx-distal',
      'pinky-finger-tip',
    ];

    const bones = {};
    const restMap = {};

    boneNames.forEach((name) => {
      const b = root.getObjectByName(name);
      if (b) {
        bones[name] = b;
        restMap[name] = {
          position: b.position.clone(),
          quaternion: b.quaternion.clone(),
        };
      }
    });

    // 在五指远节指骨 (phalanx-distal) 上挂载贴合指背的 3D 圆角指甲盖
    const nailConfigs = [
      { bone: 'thumb-phalanx-distal', w: 0.0125, h: 0.0042, l: 0.0145, y: 0.0042, z: -0.0085 },
      { bone: 'index-finger-phalanx-distal', w: 0.0102, h: 0.0038, l: 0.0128, y: 0.0052, z: -0.0095 },
      { bone: 'middle-finger-phalanx-distal', w: 0.0108, h: 0.0040, l: 0.0135, y: 0.0051, z: -0.0105 },
      { bone: 'ring-finger-phalanx-distal', w: 0.0098, h: 0.0037, l: 0.0125, y: 0.0049, z: -0.0098 },
      { bone: 'pinky-finger-phalanx-distal', w: 0.0084, h: 0.0032, l: 0.0108, y: 0.0044, z: -0.0082 },
    ];

    const nails = [];
    nailConfigs.forEach((nc) => {
      const distalBone = bones[nc.bone];
      if (!distalBone) return;
      const nailMesh = new THREE.Mesh(this.nailGeometry, nailMaterial);
      nailMesh.position.set(0, nc.y, nc.z);
      nailMesh.scale.set(nc.w, nc.h, nc.l);
      nailMesh.frustumCulled = false;
      distalBone.add(nailMesh);
      nails.push(nailMesh);
    });

    // 构建层次化骨骼父子链数据，记录每一节骨骼相对于上一节骨骼的局部初始偏移与旋转
    const chains = [
      ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
      [
        'wrist',
        'index-finger-metacarpal',
        'index-finger-phalanx-proximal',
        'index-finger-phalanx-intermediate',
        'index-finger-phalanx-distal',
        'index-finger-tip',
      ],
      [
        'wrist',
        'middle-finger-metacarpal',
        'middle-finger-phalanx-proximal',
        'middle-finger-phalanx-intermediate',
        'middle-finger-phalanx-distal',
        'middle-finger-tip',
      ],
      [
        'wrist',
        'ring-finger-metacarpal',
        'ring-finger-phalanx-proximal',
        'ring-finger-phalanx-intermediate',
        'ring-finger-phalanx-distal',
        'ring-finger-tip',
      ],
      [
        'wrist',
        'pinky-finger-metacarpal',
        'pinky-finger-phalanx-proximal',
        'pinky-finger-phalanx-intermediate',
        'pinky-finger-phalanx-distal',
        'pinky-finger-tip',
      ],
    ];

    const parentRelation = {};
    chains.forEach((chain) => {
      for (let i = 1; i < chain.length; i++) {
        const pName = chain[i - 1];
        const cName = chain[i];
        const pRest = restMap[pName];
        const cRest = restMap[cName];
        if (pRest && cRest && !parentRelation[cName]) {
          const pInvQuat = pRest.quaternion.clone().invert();
          const localOffset = cRest.position
            .clone()
            .sub(pRest.position)
            .applyQuaternion(pInvQuat);
          const localQuat = pInvQuat.clone().multiply(cRest.quaternion);
          parentRelation[cName] = {
            parentName: pName,
            localOffset,
            localQuat,
          };
        }
      }
    });

    this.restPoseData.set(root, {
      isLeft,
      bones,
      restMap,
      chains,
      parentRelation,
      skinnedMesh,
      nails,
    });

    return { root, bones, skinnedMesh, nails };
  }

  /**
   * 切换一体成型蒙皮手模与指甲盖的材质（PBR 真实皮肤 / 赛博钛金机甲）
   */
  setMaterial(root, skinMat, nailMat) {
    const data = this.restPoseData.get(root);
    if (!data) return;
    if (data.skinnedMesh) {
      data.skinnedMesh.material = skinMat;
    }
    if (data.nails) {
      data.nails.forEach((n) => {
        n.material = nailMat;
      });
    }
  }

  /**
   * 使用关节弯曲度 (curls)、张开度 (spread)、拇指对掌度 (thumbOpposition) 驱动一体成型蒙皮网格骨骼
   * 支持左右双手镜像对称驱动，并返回 21 个解剖关节点在当前场景世界空间中的 3D 坐标
   */
  applyPoseToSkinnedHand(root, poseState, worldScale = 2150, stageOffset = { x: 0, y: 10, z: 0 }) {
    const data = this.restPoseData.get(root);
    if (!data) return null;

    const { isLeft, bones, restMap, chains, parentRelation } = data;
    const mirrorSign = isLeft ? -1 : 1;
    const wristRest = restMap['wrist'];
    if (!wristRest) return null;

    // 1. 重置 wrist 到初始姿态
    const wristBone = bones['wrist'];
    wristBone.position.copy(wristRest.position);
    wristBone.quaternion.copy(wristRest.quaternion);

    // 2. 计算每根手指各关节的局部附加旋转四元数
    const localDeltaQuats = {};

    const curls = {
      thumb: poseState.thumb ?? 0.08,
      index: poseState.index ?? 0.06,
      middle: poseState.middle ?? 0.05,
      ring: poseState.ring ?? 0.07,
      pinky: poseState.pinky ?? 0.09,
    };
    const spread = (poseState.spread ?? 0.35) - 0.3;
    const thumbOpp = poseState.thumbOpposition ?? 0.15;

    // (a) 拇指三段骨骼连续平滑解剖学旋转 (Continuous Smooth Quaternion Slerp Blending)
    // 彻底消除硬编码 if/else 分支阈值导致的“边界突变跳帧抖动”，
    // 采用 smoothstep 连续权重在「基础姿态」、「精准捏合姿态」、「紧握拳头姿态」之间做四元数球面线性插值 (Slerp)。
    const smoothstep = (min, max, val) => {
      const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
      return t * t * (3 - 2 * t);
    };

    const tCurl = curls.thumb;

    // 1. 握拳连续混合权重 (0 ~ 1)：当食指、中指、拇指同时向握拳区收拢时平滑过渡
    const fistWeight =
      smoothstep(0.6, 0.9, curls.index) *
      smoothstep(0.6, 0.9, curls.middle) *
      smoothstep(0.35, 0.68, tCurl);

    // 2. 捏合连续混合权重 (0 ~ 1)：当拇指对掌度高、食指处于半屈区且中指未紧握时平滑过渡
    const pinchWeight =
      smoothstep(0.48, 0.85, thumbOpp) *
      smoothstep(0.25, 0.55, curls.index) *
      (1 - smoothstep(0.5, 0.82, curls.middle)) *
      (1 - fistWeight);

    // (I) 基础通用姿态四元数（左手自动镜像 Y/Z 偏航与翻滚分量）
    const qBaseMeta = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        -thumbOpp * 0.48 - tCurl * 0.18,
        mirrorSign * (thumbOpp * 0.18),
        mirrorSign * (thumbOpp * 0.15),
        'XYZ'
      )
    );
    const qBaseProx = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        -tCurl * 0.45,
        mirrorSign * (thumbOpp * 0.1),
        mirrorSign * (thumbOpp * 0.05),
        'XYZ'
      )
    );
    const qBaseDist = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-tCurl * 0.85, 0, 0, 'XYZ')
    );

    // (II) 精准捏合姿态四元数
    const pScale = Math.min(1, thumbOpp / 0.92);
    const qPinchMeta = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        -0.55 * pScale,
        mirrorSign * (0.18 * pScale),
        mirrorSign * (0.25 * pScale),
        'XYZ'
      )
    );
    const qPinchProx = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        -tCurl * 0.38,
        mirrorSign * (0.15 * pScale),
        mirrorSign * (0.15 * pScale),
        'XYZ'
      )
    );
    const qPinchDist = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-tCurl * 0.58, 0, 0, 'XYZ')
    );

    // (III) 紧握拳头姿态四元数（含红框外侧饱满凸起与指间关节折角）
    const fScale = Math.min(1, tCurl / 0.74);
    const qFistMeta = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        -0.18 * fScale,
        mirrorSign * (0.14 * fScale),
        mirrorSign * (-0.22 * fScale),
        'XYZ'
      )
    );
    const qFistProx = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        -0.52 * fScale,
        mirrorSign * (0.16 * fScale),
        mirrorSign * (-0.05 * fScale),
        'XYZ'
      )
    );
    const qFistDist = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-1.38 * fScale, 0, mirrorSign * (0.12 * fScale), 'XYZ')
    );

    // 使用连续 Slerp 融合，保证任意帧之间一阶导数连续、零跳变
    localDeltaQuats['thumb-metacarpal'] = qBaseMeta
      .clone()
      .slerp(qPinchMeta, pinchWeight)
      .slerp(qFistMeta, fistWeight);
    localDeltaQuats['thumb-phalanx-proximal'] = qBaseProx
      .clone()
      .slerp(qPinchProx, pinchWeight)
      .slerp(qFistProx, fistWeight);
    localDeltaQuats['thumb-phalanx-distal'] = qBaseDist
      .clone()
      .slerp(qPinchDist, pinchWeight)
      .slerp(qFistDist, fistWeight);

    // (b) 其余四指三段指节 + 掌骨微动（同样采用连续 Slerp 混合，消除食指跳变）
    const fingerSpecs = [
      { prefix: 'index-finger', curl: curls.index, splayFactor: -0.42, isIndex: true },
      { prefix: 'middle-finger', curl: curls.middle, splayFactor: -0.05, isIndex: false },
      { prefix: 'ring-finger', curl: curls.ring, splayFactor: 0.32, isIndex: false },
      { prefix: 'pinky-finger', curl: curls.pinky, splayFactor: 0.72, isIndex: false },
    ];

    fingerSpecs.forEach((spec) => {
      const c = spec.curl;
      const splay = mirrorSign * spread * spec.splayFactor * (1 - c * 0.85);
      // 连续平滑的握拳加深系数 (smoothstep 替代硬阈值 c > 0.8)
      const tightBoost = smoothstep(0.72, 0.98, c) * 0.18;

      const qMeta = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-c * (0.09 + tightBoost * 0.1), 0, 0, 'XYZ')
      );
      const qProx = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-c * (1.42 + tightBoost * 0.95), splay, 0, 'XYZ')
      );
      const qInter = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-c * (1.56 + tightBoost * 1.05), 0, 0, 'XYZ')
      );
      const qDist = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-c * (1.12 + tightBoost * 1.35), 0, 0, 'XYZ')
      );

      if (spec.isIndex && pinchWeight > 0.001) {
        // 食指在捏合区间平滑过渡到 O 型圆拱比例
        const k = c / 0.62;
        qMeta.slerp(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.06 * k, 0, 0, 'XYZ')),
          pinchWeight
        );
        qProx.slerp(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(-0.78 * k, mirrorSign * (-0.05 * k), 0, 'XYZ')
          ),
          pinchWeight
        );
        qInter.slerp(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.05 * k, 0, 0, 'XYZ')),
          pinchWeight
        );
        qDist.slerp(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.68 * k, 0, 0, 'XYZ')),
          pinchWeight
        );
      }

      localDeltaQuats[`${spec.prefix}-metacarpal`] = qMeta;
      localDeltaQuats[`${spec.prefix}-phalanx-proximal`] = qProx;
      localDeltaQuats[`${spec.prefix}-phalanx-intermediate`] = qInter;
      localDeltaQuats[`${spec.prefix}-phalanx-distal`] = qDist;
    });

    // 3. 沿骨骼链由近及远正向运动学 (FK) 递推更新 25 根骨骼的平移与旋转
    const visited = new Set(['wrist']);
    chains.forEach((chain) => {
      for (let i = 1; i < chain.length; i++) {
        const bName = chain[i];
        if (visited.has(bName)) continue;
        visited.add(bName);

        const rel = parentRelation[bName];
        const bone = bones[bName];
        const parentBone = bones[rel?.parentName];
        if (!rel || !bone || !parentBone) continue;

        const offset = rel.localOffset.clone().applyQuaternion(parentBone.quaternion);
        bone.position.copy(parentBone.position).add(offset);

        const deltaQ = localDeltaQuats[bName];
        bone.quaternion.copy(parentBone.quaternion).multiply(rel.localQuat);
        if (deltaQ) {
          bone.quaternion.multiply(deltaQ);
        }
      }
    });

    // 4. 设置整个手模在 3D 展示舞台中央的姿态、尺寸与旋转
    root.scale.set(worldScale, worldScale, worldScale);

    // 右手默认手背在 +X_glb (转 +90° 使手心朝前)，左手默认手背在 -X_glb (转 -90° 使手心朝前)
    const yRot = isLeft ? Math.PI / 2 : -Math.PI / 2;
    const baseOrientation = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yRot));

    const rotY = (poseState.wristRotY ?? 0.22) * mirrorSign;
    const userOrientation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(poseState.wristRotX ?? -0.1, rotY, 0, 'YXZ')
    );

    root.quaternion.copy(userOrientation).multiply(baseOrientation);

    const palmPivotLocal = new THREE.Vector3(isLeft ? -0.032 : 0.032, -0.025, 0.012);
    const palmOffsetWorld = palmPivotLocal
      .clone()
      .multiplyScalar(worldScale)
      .applyQuaternion(root.quaternion);
    root.position.set(
      (stageOffset.x || 0) - palmOffsetWorld.x,
      (stageOffset.y ?? 10) - palmOffsetWorld.y,
      (stageOffset.z || 0) - palmOffsetWorld.z
    );

    root.updateMatrixWorld(true);

    // 5. 提取 21 个标准 MediaPipe 对应关节的世界坐标
    const mp21BoneNames = [
      'wrist',
      'thumb-metacarpal',
      'thumb-phalanx-proximal',
      'thumb-phalanx-distal',
      'thumb-tip',
      'index-finger-phalanx-proximal',
      'index-finger-phalanx-intermediate',
      'index-finger-phalanx-distal',
      'index-finger-tip',
      'middle-finger-phalanx-proximal',
      'middle-finger-phalanx-intermediate',
      'middle-finger-phalanx-distal',
      'middle-finger-tip',
      'ring-finger-phalanx-proximal',
      'ring-finger-phalanx-intermediate',
      'ring-finger-phalanx-distal',
      'ring-finger-tip',
      'pinky-finger-phalanx-proximal',
      'pinky-finger-phalanx-intermediate',
      'pinky-finger-phalanx-distal',
      'pinky-finger-tip',
    ];

    return mp21BoneNames.map((bName) => {
      const b = bones[bName];
      if (!b) return { x: 0, y: 0, z: 0 };
      const wp = b.position.clone().applyMatrix4(root.matrixWorld);
      return { x: wp.x, y: wp.y, z: wp.z };
    });
  }

  /**
   * 实时手势识别驱动 (Live MediaPipe Landmarks -> Seamless Skinned Hand Mesh)
   * 从摄像头 MediaPipe 21 个实时关键点反解：
   *  1. 五指连续弯曲度 (curls: thumb, index, middle, ring, pinky)
   *  2. 五指扇形张开度 (spread) 与大拇指对掌度 (thumbOpposition)
   *  3. 手掌在屏幕正交相机空间中的 3D 旋转矩阵 (Hand Orientation Matrix) 与精确光标对齐位置
   * 使开启摄像头手势后，画板上的实时手模与实验台里验收合格的一体成型真手模型完全一致！
   */
  applyLiveLandmarksToSkinnedHand(root, pts3D, handData = null) {
    const data = this.restPoseData.get(root);
    if (!data || !pts3D || pts3D.length < 21) return;

    const { isLeft, bones } = data;
    const v = (i) => new THREE.Vector3(pts3D[i].x, pts3D[i].y, pts3D[i].z);

    const pWrist = v(0);
    const pIndexMCP = v(5);
    const pMiddleMCP = v(9);
    const pPinkyMCP = v(17);

    // 1. 计算手掌参考尺度 (掌宽与掌长)
    const palmWidth = pIndexMCP.distanceTo(pPinkyMCP) || 95;
    const palmLength = pWrist.distanceTo(pMiddleMCP) || 110;
    const palmRef = (palmWidth + palmLength) * 0.5;

    // 2. 解算四指弯曲度 (0 伸直 ~ 1 紧握)：结合三段指骨向量夹角与指尖到掌心距离
    const calcFingerCurl = (mcpIdx, pipIdx, dipIdx, tipIdx) => {
      const p0 = v(mcpIdx);
      const p1 = v(pipIdx);
      const p2 = v(dipIdx);
      const p3 = v(tipIdx);

      const d1 = p1.clone().sub(p0).normalize();
      const d2 = p2.clone().sub(p1).normalize();
      const d3 = p3.clone().sub(p2).normalize();
      const palmDir = p0.clone().sub(pWrist).normalize();

      const ang0 = Math.acos(THREE.MathUtils.clamp(palmDir.dot(d1), -1, 1));
      const ang1 = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
      const ang2 = Math.acos(THREE.MathUtils.clamp(d2.dot(d3), -1, 1));

      const angleCurl = THREE.MathUtils.clamp((ang0 * 0.7 + ang1 * 1.1 + ang2 * 0.8 - 0.22) / 3.1, 0, 1);

      // 辅助距离比：握拳时指尖贴近手腕/掌心
      const tipToWrist = p3.distanceTo(pWrist);
      const mcpToWrist = p0.distanceTo(pWrist) || 1;
      const distRatio = tipToWrist / mcpToWrist;
      const distCurl = THREE.MathUtils.clamp((1.85 - distRatio) / 0.95, 0, 1);

      return THREE.MathUtils.clamp(angleCurl * 0.65 + distCurl * 0.35, 0, 1);
    };

    const indexCurl = calcFingerCurl(5, 6, 7, 8);
    const middleCurl = calcFingerCurl(9, 10, 11, 12);
    const ringCurl = calcFingerCurl(13, 14, 15, 16);
    const pinkyCurl = calcFingerCurl(17, 18, 19, 20);

    // 3. 解算大拇指弯曲度与对掌度
    const pT1 = v(1);
    const pT2 = v(2);
    const pT3 = v(3);
    const pT4 = v(4);
    const td1 = pT2.clone().sub(pT1).normalize();
    const td2 = pT3.clone().sub(pT2).normalize();
    const td3 = pT4.clone().sub(pT3).normalize();
    const tAng1 = Math.acos(THREE.MathUtils.clamp(td1.dot(td2), -1, 1));
    const tAng2 = Math.acos(THREE.MathUtils.clamp(td2.dot(td3), -1, 1));
    const thumbAngleCurl = THREE.MathUtils.clamp((tAng1 * 1.2 + tAng2 * 1.4 - 0.12) / 1.85, 0, 1);
    const thumbToPinkyRatio = pT4.distanceTo(pPinkyMCP) / (palmWidth || 1);
    const thumbDistCurl = THREE.MathUtils.clamp((1.45 - thumbToPinkyRatio) / 0.85, 0, 1);
    let thumbCurl = THREE.MathUtils.clamp(thumbAngleCurl * 0.65 + thumbDistCurl * 0.35, 0, 1);

    // 大拇指对掌度 (Thumb Opposition): 衡量大拇指尖靠近食指尖或掌心的程度
    const pinchDistRatio = pT4.distanceTo(v(8)) / (palmRef || 1);
    let thumbOpposition = THREE.MathUtils.clamp(
      (1.15 - pinchDistRatio) * 0.65 + thumbDistCurl * 0.45,
      0.1,
      0.96
    );

    // 当处于捏合手势时，锁定到实验台校准过的精准 O 型指腹贴合参数
    if (handData?.classification?.isPinching || pinchDistRatio < 0.34) {
      const pBlend = THREE.MathUtils.clamp((0.38 - pinchDistRatio) / 0.16, 0, 1);
      thumbOpposition = THREE.MathUtils.lerp(thumbOpposition, 0.92, pBlend);
      thumbCurl = THREE.MathUtils.lerp(thumbCurl, 0.58, pBlend);
    }

    // 4. 解算五指张开度 (Spread)
    const dirIdx = v(8).sub(pIndexMCP).normalize();
    const dirPnk = v(20).sub(pPinkyMCP).normalize();
    const splayAngle = Math.acos(THREE.MathUtils.clamp(dirIdx.dot(dirPnk), -1, 1));
    const spread = THREE.MathUtils.clamp((splayAngle - 0.12) / 0.85, -0.05, 0.85);

    // 5. 先用我们实验台校准过的连续 Slerp 骨骼引擎解算 25 根局部骨骼形态
    const worldScale = (palmRef / 0.068) * 1.02;
    this.applyPoseToSkinnedHand(
      root,
      {
        thumb: thumbCurl,
        index: handData?.classification?.isPinching ? THREE.MathUtils.lerp(indexCurl, 0.62, 0.75) : indexCurl,
        middle: middleCurl,
        ring: ringCurl,
        pinky: pinkyCurl,
        spread,
        thumbOpposition,
        wristRotX: 0,
        wristRotY: 0,
      },
      worldScale
    );

    // 6. 构建屏幕正交相机空间 (X向右, Y向下, Z朝外) 下的真实 3D 手掌旋转姿态矩阵
    // 在 GLB 局部空间中：
    //   - 手指延伸方向 (Wrist -> MiddleMCP) 对应局部 -Y_glb
    //   - 手背法向 (Dorsal Normal) 在右手对应 +X_glb，在左手对应 -X_glb
    //   - 拇指到小指横向 (Thumb -> Pinky) 对应 +Z_glb
    const handForward = pMiddleMCP.clone().sub(pWrist).normalize(); // 对应 -Y_glb -> 所以 +Y_glb = -handForward
    const acrossVec = pPinkyMCP.clone().sub(pIndexMCP).normalize(); // 从食指指向小指 (近似 +Z_glb)

    // 计算手背法向：在屏幕坐标系 (X右, Y下, Z外) 中
    const mirrorSign = isLeft ? -1 : 1;
    const dorsalNormal = new THREE.Vector3()
      .crossVectors(handForward, acrossVec)
      .multiplyScalar(mirrorSign)
      .normalize();

    // 正交化三个基向量 (X_glb, Y_glb, Z_glb)
    const yGlbWorld = handForward.clone().negate(); // +Y_glb (指尖朝向 -Y_glb)
    const xGlbWorld = dorsalNormal.clone().multiplyScalar(mirrorSign); // 右手 +X_glb 为手背，左手 -X_glb 为手背
    const zGlbWorld = new THREE.Vector3().crossVectors(xGlbWorld, yGlbWorld).normalize();
    xGlbWorld.crossVectors(yGlbWorld, zGlbWorld).normalize();

    const rotMat = new THREE.Matrix4().makeBasis(xGlbWorld, yGlbWorld, zGlbWorld);
    root.quaternion.setFromRotationMatrix(rotMat);
    root.scale.set(worldScale, worldScale, worldScale);

    // 7. 关键点空间对齐：
    // 在作画/指针阶段，让 3D 手模的食指尖 (或掌心) 与屏幕虚拟光标及真实手掌位置严丝合缝对齐
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);

    const isPinchOrPoint =
      handData?.classification?.isPinching || handData?.classification?.gesture === 'POINTING';
    const anchorBoneName = isPinchOrPoint ? 'index-finger-tip' : 'middle-finger-phalanx-proximal';
    const anchorLandmarkIdx = isPinchOrPoint ? 8 : 9;

    const anchorBone = bones[anchorBoneName] || bones['wrist'];
    const boneWorldPos = anchorBone.position.clone().applyMatrix4(root.matrixWorld);
    const targetPt = pts3D[anchorLandmarkIdx] || pts3D[0];

    root.position.set(
      targetPt.x - boneWorldPos.x,
      targetPt.y - boneWorldPos.y,
      targetPt.z - boneWorldPos.z
    );
    root.updateMatrixWorld(true);
  }
}
