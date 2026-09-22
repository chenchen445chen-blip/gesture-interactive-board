/**
 * 手势分类器 (GestureClassifier)
 * 根据 MediaPipe 提取的 21 个手部关键点 (Landmarks) 计算欧几里得几何距离与手指标记
 */
export class GestureClassifier {
  constructor() {
    // 捏合阈值（基于手掌大小归一化的距离）
    this.pinchThreshold = 0.08;
    this.pinchReleaseThreshold = 0.12;
    this.isCurrentlyPinching = false;
  }

  /**
   * 计算两点间的归一化欧式距离
   */
  static distance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = (p1.z || 0) - (p2.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * 判断手指是否伸展 (Tip 距离手腕的距离是否显著大于 PIP 距离手腕的距离)
   */
  isFingerExtended(landmarks, tipIdx, pipIdx) {
    const wrist = landmarks[0];
    const tipDist = GestureClassifier.distance(landmarks[tipIdx], wrist);
    const pipDist = GestureClassifier.distance(landmarks[pipIdx], wrist);
    return tipDist > pipDist * 1.15;
  }

  /**
   * 判定手部朝向（手心还是手背朝向摄像头）
   * 基于手掌基底三角形（0 号手腕、5 号食指掌骨根部、17 号小指掌骨根部）的法向量叉乘判定
   * @param {Array<{x: number, y: number, z: number}>} landmarks
   * @param {string} handedness 'Left' | 'Right'
   * @returns {{ facing: 'PALM' | 'BACK', isPalm: boolean, isBack: boolean }}
   */
  determineHandFacing(landmarks, handedness = 'Right') {
    const p0 = landmarks[0];   // 手腕
    const p5 = landmarks[5];   // 食指 MCP
    const p17 = landmarks[17]; // 小指 MCP

    // V1: 手腕 -> 食指根部
    const v1x = p5.x - p0.x;
    const v1y = p5.y - p0.y;

    // V2: 手腕 -> 小指根部
    const v2x = p17.x - p0.x;
    const v2y = p17.y - p0.y;

    // 平面二维叉乘 (衡量点集逆时针/顺时针缠绕方向)
    const crossZ = v1x * v2y - v1y * v2x;

    // 考虑计算机图像 Y 轴向下与前置自拍镜像视角校准：
    // 当右手手心朝向镜头时 crossZ < 0，手背朝向时 crossZ > 0
    // 左手手心朝向镜头时 crossZ > 0，手背朝向时 crossZ < 0
    const isRightHand = handedness.toLowerCase() === 'right';
    const isPalm = isRightHand ? (crossZ < 0) : (crossZ > 0);

    return {
      facing: isPalm ? 'PALM' : 'BACK',
      isPalm,
      isBack: !isPalm,
    };
  }

  /**
   * 分析手部骨骼并分类当前手势
   * @param {Array<{x: number, y: number, z: number}>} landmarks 21 个手部关键点
   * @param {string} handedness 'Left' | 'Right'
   * @returns {Object}
   */
  classify(landmarks, handedness = 'Right') {
    if (!landmarks || landmarks.length < 21) {
      return {
        gesture: 'UNKNOWN',
        isPinching: false,
        isOpenPalm: false,
        pinchDistance: 1,
        indexTip: null,
        facing: 'UNKNOWN',
        isPalm: false,
        isBack: false,
      };
    }

    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];

    // 检测手指伸展状态
    const indexExtended = this.isFingerExtended(landmarks, 8, 6);
    const middleExtended = this.isFingerExtended(landmarks, 12, 10);
    const ringExtended = this.isFingerExtended(landmarks, 16, 14);
    const pinkyExtended = this.isFingerExtended(landmarks, 20, 18);

    // 判断手心还是手背朝向
    const { facing, isPalm, isBack } = this.determineHandFacing(landmarks, handedness);

    // 计算手掌参考尺度 (手腕到中指掌指关节)，使捏合判定自适应镜头远近
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];
    const palmRef = Math.max(0.06, GestureClassifier.distance(wrist, middleMcp));

    // 计算食指与大拇指尖的真实几何距离
    const pinchDist = GestureClassifier.distance(thumbTip, indexTip);
    // 归一化比例：两指间距占手掌长度的比例
    const pinchRatio = pinchDist / palmRef;

    // 当五指完全张开或中指无名指完全展开时，强制不视为捏合
    const allFingersOpen = indexExtended && middleExtended && ringExtended && pinkyExtended;

    // 严谨的触碰判定：必须两指尖极其贴近（距离比例小于 0.26 且绝对归一化距离小于 0.042）才判定为触碰
    // 一旦两指稍微分开（比例大于 0.36 或绝对距离大于 0.058）立即释放停笔
    if (this.isCurrentlyPinching) {
      if (pinchRatio > 0.36 || pinchDist > 0.058 || allFingersOpen) {
        this.isCurrentlyPinching = false;
      }
    } else {
      if (pinchRatio < 0.26 && pinchDist < 0.042 && !allFingersOpen) {
        this.isCurrentlyPinching = true;
      }
    }

    // 计算手掌中心点 (手腕与中指指根之间) 与手掌大致尺寸
    const palmCenter = {
      x: (wrist.x + middleMcp.x) / 2,
      y: (wrist.y + middleMcp.y) / 2,
      z: ((wrist.z || 0) + (middleMcp.z || 0)) / 2,
    };
    const palmSize = GestureClassifier.distance(wrist, middleTip);

    let gesture = 'UNKNOWN';

    // 优先判断捏合（画笔/点击）
    if (this.isCurrentlyPinching) {
      gesture = 'PINCH'; // 捏合手势（绘图/点击）
    } else if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
      // 五指张开时，区分手心与手背
      gesture = isPalm ? 'OPEN_PALM' : 'BACK_HAND';
    } else if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      gesture = 'POINTING'; // 纯食指指引光标
    } else if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      gesture = 'FIST'; // 握拳
    } else if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
      gesture = 'PEACE'; // 剪刀手
    } else {
      gesture = 'TRACKING'; // 普通追踪
    }

    return {
      gesture,
      isPinching: this.isCurrentlyPinching,
      isOpenPalm: gesture === 'OPEN_PALM',
      pinchDistance: pinchDist,
      pinchRatio,
      facing,
      isPalm,
      isBack,
      indexTip,
      thumbTip,
      palmCenter,
      palmSize,
    };
  }
}
