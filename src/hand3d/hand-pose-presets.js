import * as THREE from 'three';

/**
 * 静态开发模式 — 3D 人手解剖学姿态生成器与预设库 (Anatomical Forward Kinematics Pose Generator)
 *
 * 生成标准 21 节点 3D 坐标（以手掌中心为原点，Y 轴向上，Z 轴朝向屏幕前方），
 * 支持：
 *  1. 6 种标准预设静态手势（自然张开、捏合下笔、握拳、单指指引、胜利手势 V、摇滚手势）
 *  2. 5 根手指独立弯曲度 (Curl: 0~1) + 张开度 (Spread: -0.5~1) + 手腕俯仰旋转调节
 *  3. Remotion 帧序列时间轴 (Frame 0 ~ 120) 关键帧插值计算
 */

export const HAND_POSE_PRESETS = {
  open: {
    id: 'open',
    name: '🖐️ 自然张开 (Open Palm)',
    desc: '五指自然舒展微弧，展示掌弓与指蹼解剖结构',
    curls: { thumb: 0.08, index: 0.06, middle: 0.05, ring: 0.07, pinky: 0.09 },
    spread: 0.35,
    thumbOpposition: 0.15,
  },
  pinch: {
    id: 'pinch',
    name: '🤏 捏合下笔 (Precision Pinch)',
    desc: '拇指与食指指腹精准对位捏合，其余三指自然阶梯微屈',
    curls: { thumb: 0.58, index: 0.62, middle: 0.22, ring: 0.34, pinky: 0.46 },
    spread: 0.22,
    thumbOpposition: 0.92,
  },
  point: {
    id: 'point',
    name: '☝️ 单指指引 (Index Point)',
    desc: '食指完全伸直指向前方，拇指与中无名小指收拢',
    curls: { thumb: 0.58, index: 0.02, middle: 0.88, ring: 0.92, pinky: 0.95 },
    spread: 0.1,
    thumbOpposition: 0.65,
  },
  fist: {
    id: 'fist',
    name: '✊ 紧握拳头 (Closed Fist)',
    desc: '四指三段指节卷曲收拢入掌心，拇指横扣锁紧',
    curls: { thumb: 0.74, index: 0.96, middle: 0.98, ring: 0.98, pinky: 0.98 },
    spread: -0.05,
    thumbOpposition: 0.82,
  },
  peace: {
    id: 'peace',
    name: '✌️ 胜利比耶 (Victory V)',
    desc: '食指与中指呈 V 字分叉伸展，无名指与小指扣合',
    curls: { thumb: 0.68, index: 0.03, middle: 0.03, ring: 0.92, pinky: 0.95 },
    spread: 0.55,
    thumbOpposition: 0.78,
  },
  rock: {
    id: 'rock',
    name: '🤘 赛博摇滚 (Cyber Rock)',
    desc: '拇指、食指、小指外展伸直，中指与无名指收拢掌心',
    curls: { thumb: 0.08, index: 0.04, middle: 0.92, ring: 0.94, pinky: 0.04 },
    spread: 0.45,
    thumbOpposition: 0.2,
  },
};

/**
 * 根据关节弯曲参数正向运动学 (Forward Kinematics) 解算 21 个解剖学 3D 坐标
 * 坐标系：原点 (0,0,0) 在掌心中心，Y 轴朝上（指尖方向），X 轴向右，Z 轴朝向观察者（手心方向 +Z，手背 -Z）
 */
export function computeAnatomicalHandPoints(params = {}) {
  const curls = params.curls || HAND_POSE_PRESETS.open.curls;
  const spread = params.spread ?? 0.35;
  const thumbOpp = params.thumbOpposition ?? 0.15;

  const pts = new Array(21);

  // 0: 手腕中心 (Wrist)
  pts[0] = new THREE.Vector3(0, -108, 0);

  // ═══════════════════════════════════════════════════════
  // 拇指正向运动学 (Thumb: 1 CMC -> 2 MCP -> 3 IP -> 4 TIP)
  // ═══════════════════════════════════════════════════════
  const tCurl = curls.thumb ?? 0.1;
  pts[1] = new THREE.Vector3(-42, -74, 14);

  // 拇指掌骨朝向随对掌度 (thumbOpposition) 向掌心内旋
  const cmcAngleZ = 0.65 - thumbOpp * 0.48;
  const cmcAngleX = 0.25 + thumbOpp * 0.55;
  const dir12 = new THREE.Vector3(
    -Math.sin(cmcAngleZ) * Math.cos(cmcAngleX),
    Math.cos(cmcAngleZ),
    Math.sin(cmcAngleX)
  ).normalize();
  pts[2] = pts[1].clone().addScaledVector(dir12, 48);

  // 拇指近节 (2 -> 3)
  const mcpFlex = tCurl * 0.95;
  const dir23 = dir12.clone()
    .applyAxisAngle(new THREE.Vector3(0, 0, -1), mcpFlex * 0.85)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), thumbOpp * 0.45)
    .normalize();
  pts[3] = pts[2].clone().addScaledVector(dir23, 38);

  // 拇指末节 (3 -> 4)
  const ipFlex = tCurl * 1.15;
  const dir34 = dir23.clone()
    .applyAxisAngle(new THREE.Vector3(0, 0, -1), ipFlex * 0.95)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), thumbOpp * 0.25)
    .normalize();
  pts[4] = pts[3].clone().addScaledVector(dir34, 32);

  // 如果是精准捏合姿态，让拇指尖 (4) 与食指尖 (8) 自然靠拢
  // ═══════════════════════════════════════════════════════
  // 四指正向运动学 (Index, Middle, Ring, Pinky)
  // ═══════════════════════════════════════════════════════
  const fingerConfigs = [
    {
      name: 'index',
      indices: [5, 6, 7, 8],
      mcpPos: new THREE.Vector3(-44, 2, 4),
      baseSplay: 0.18,
      lengths: [52, 34, 26],
      inwardTilt: -0.08,
    },
    {
      name: 'middle',
      indices: [9, 10, 11, 12],
      mcpPos: new THREE.Vector3(-14, 10, 0),
      baseSplay: 0.04,
      lengths: [58, 38, 28],
      inwardTilt: -0.02,
    },
    {
      name: 'ring',
      indices: [13, 14, 15, 16],
      mcpPos: new THREE.Vector3(17, 5, 3),
      baseSplay: -0.09,
      lengths: [53, 35, 26],
      inwardTilt: 0.06,
    },
    {
      name: 'pinky',
      indices: [17, 18, 19, 20],
      mcpPos: new THREE.Vector3(45, -8, 8),
      baseSplay: -0.24,
      lengths: [42, 27, 23],
      inwardTilt: 0.14,
    },
  ];

  fingerConfigs.forEach((cfg) => {
    const fCurl = curls[cfg.name] ?? 0.08;
    const [iMCP, iPIP, iDIP, iTIP] = cfg.indices;

    pts[iMCP] = cfg.mcpPos.clone();

    // 手指弯曲时外展角自动收拢 (解剖学规律：握拳时五指并拢)
    const activeSpread = spread * (1 - fCurl * 0.85);
    const splayAngle = cfg.baseSplay * (0.5 + activeSpread * 1.4);

    // 三段关节弯曲角度 (MCP, PIP, DIP)
    const angleMCP = fCurl * 1.38;
    const anglePIP = fCurl * 1.62;
    const angleDIP = fCurl * 1.15;

    // 弯曲平面法向（四指弯曲时微向掌心中央聚拢）
    const bendAxis = new THREE.Vector3(1, 0, cfg.inwardTilt).normalize();

    // 1. 近节指骨 (MCP -> PIP)
    const dir1 = new THREE.Vector3(0, 1, 0)
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), splayAngle)
      .applyAxisAngle(bendAxis, angleMCP)
      .normalize();
    pts[iPIP] = pts[iMCP].clone().addScaledVector(dir1, cfg.lengths[0]);

    // 2. 中节指骨 (PIP -> DIP)
    const dir2 = dir1.clone().applyAxisAngle(bendAxis, anglePIP).normalize();
    pts[iDIP] = pts[iPIP].clone().addScaledVector(dir2, cfg.lengths[1]);

    // 3. 远节指骨 (DIP -> TIP)
    const dir3 = dir2.clone().applyAxisAngle(bendAxis, angleDIP).normalize();
    pts[iTIP] = pts[iDIP].clone().addScaledVector(dir3, cfg.lengths[2]);
  });

  // 精准捏合对位修正：当 thumbOpposition > 0.75 且拇指食指均处于半屈捏合区时，使指腹自然相触
  if (thumbOpp > 0.72 && curls.index > 0.45 && curls.index < 0.8 && curls.thumb > 0.45) {
    const pinchStrength = Math.min(1, (thumbOpp - 0.72) / 0.2);
    const meetPoint = new THREE.Vector3()
      .addVectors(pts[4], pts[8])
      .multiplyScalar(0.5);
    pts[4].lerp(meetPoint.clone().add(new THREE.Vector3(-4, -3, 2)), pinchStrength * 0.78);
    pts[8].lerp(meetPoint.clone().add(new THREE.Vector3(4, 3, -2)), pinchStrength * 0.78);
  }

  return pts;
}

/**
 * 07. Remotion — 基于帧号 (Frame 0 ~ 120) 的确定性姿态时间轴计算
 * 让用户可以像 Remotion 代码视频一样，拖动任意帧号精确预览 3D 手部连续关键帧动作
 */
export function evaluateRemotionFramePose(frame, totalFrames = 120) {
  const sequence = [
    HAND_POSE_PRESETS.open,
    HAND_POSE_PRESETS.pinch,
    HAND_POSE_PRESETS.point,
    HAND_POSE_PRESETS.peace,
    HAND_POSE_PRESETS.fist,
    HAND_POSE_PRESETS.rock,
    HAND_POSE_PRESETS.open,
  ];

  const clamped = Math.max(0, Math.min(totalFrames, frame));
  const progress = (clamped / totalFrames) * (sequence.length - 1);
  const segIdx = Math.min(sequence.length - 2, Math.floor(progress));
  const localT = progress - segIdx;
  // Smoothstep 缓动
  const t = localT * localT * (3 - 2 * localT);

  const poseA = sequence[segIdx];
  const poseB = sequence[segIdx + 1];

  return {
    curls: {
      thumb: THREE.MathUtils.lerp(poseA.curls.thumb, poseB.curls.thumb, t),
      index: THREE.MathUtils.lerp(poseA.curls.index, poseB.curls.index, t),
      middle: THREE.MathUtils.lerp(poseA.curls.middle, poseB.curls.middle, t),
      ring: THREE.MathUtils.lerp(poseA.curls.ring, poseB.curls.ring, t),
      pinky: THREE.MathUtils.lerp(poseA.curls.pinky, poseB.curls.pinky, t),
    },
    spread: THREE.MathUtils.lerp(poseA.spread, poseB.spread, t),
    thumbOpposition: THREE.MathUtils.lerp(poseA.thumbOpposition, poseB.thumbOpposition, t),
    activeLabel: `${poseA.name.split(' ')[1]} → ${poseB.name.split(' ')[1]}`,
  };
}
