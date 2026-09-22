import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { GestureClassifier } from './classifier.js';
import { CoordinateSmoother } from './filter.js';
import { MotionDetector } from './motion-detector.js';

/**
 * 手势检测主控制器 (GestureDetector)
 * 负责加载 MediaPipe Tasks Vision 模型、执行帧级推理并输出分类与滤波后的屏幕物理像素坐标
 */
export class GestureDetector {
  constructor() {
    this.handLandmarker = null;
    this.classifier  = new GestureClassifier();
    this.smoother    = new CoordinateSmoother(0.4);
    this.smootherHands = {
      Left: new CoordinateSmoother(0.4),
      Right: new CoordinateSmoother(0.4),
    };
    this.motion      = new MotionDetector({ windowSize: 12, cooldownMs: 900 });
    this.isReady     = false;
    this.lastTimestamp = -1;
    this.lastVideoTime = -1;
    this.lastResult  = null;
    this.lostFrameCount = 0;
    this.isProcessing = false;
    this.lastDetectTime = 0;
  }

  /**
   * 初始化并加载 MediaPipe 视觉模型
   * @param {Function} onProgress 可选的加载进度回调
   */
  async init(onProgress) {
    if (this.isReady) return;

    if (onProgress) onProgress('正在准备 MediaPipe WASM 运行环境...');
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    if (onProgress) onProgress('正在加载手部关键点神经网络模型...');

    // 优先尝试 GPU，若在特定 Mac 浏览器环境 WebGL 异常则自动降级到 CPU (WASM SIMD)
    try {
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2, // 允许双手检测，避免单手因角度偏转判定失败
        minHandDetectionConfidence: 0.3, // 提高抓取灵敏度，更易捕捉
        minHandPresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });
    } catch (gpuErr) {
      console.warn('GPU 加速初始化失败，尝试切换至 CPU (WASM SIMD) 模式:', gpuErr);
      if (onProgress) onProgress('切换至高兼容 CPU 模式...');
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.3,
        minHandPresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });
    }

    this.isReady = true;
    if (onProgress) onProgress('模型初始化完成！');
  }

  /**
   * 推理单帧视频
   * @param {HTMLVideoElement} videoElement
   * @param {number} timestamp 当前时间戳 (ms)
   * @param {Object} viewport 视图尺寸 { width, height }
   * @returns {Object|null}
   */
  detectFrame(videoElement, timestamp, viewport) {
    if (!this.isReady || !this.handLandmarker) return null;
    if (videoElement.readyState < 2 || videoElement.paused) return this.lastResult;

    // 严格限流门控：上一帧推理未结束，或者距上次推理不足 30ms 且视频未变时复用，避免 120Hz 循环卡死
    const now = performance.now();
    const timeDelta = now - this.lastDetectTime;
    const isVideoChanged = videoElement.currentTime !== this.lastVideoTime;

    if (this.isProcessing || (timeDelta < 30 && !isVideoChanged)) {
      return this.lastResult;
    }

    this.lastDetectTime = now;
    this.lastVideoTime = videoElement.currentTime;
    this.isProcessing = true;

    // MediaPipe detectForVideo 强约束：timestamp 必须严格单调递增
    let safeTimestamp = typeof timestamp === 'number' && !isNaN(timestamp) ? timestamp : performance.now();
    if (this.lastTimestamp >= 0 && safeTimestamp <= this.lastTimestamp) {
      safeTimestamp = this.lastTimestamp + 1;
    }
    this.lastTimestamp = safeTimestamp;

    let result = null;
    try {
      result = this.handLandmarker.detectForVideo(videoElement, safeTimestamp);
    } catch (inferErr) {
      console.warn('推理帧跳过:', inferErr);
      return this.lastResult;
    } finally {
      this.isProcessing = false;
    }

    if (!result?.landmarks || result.landmarks.length === 0) {
      this.lostFrameCount++;
      // 平滑丢帧缓冲（6帧以内的短暂遮挡或快速移动不丢弃结果）
      if (this.lostFrameCount < 6 && this.lastResult) return this.lastResult;
      this.smoother.reset();
      this.motion.reset();
      this.lastResult = null;
      return null;
    }

    this.lostFrameCount = 0;

    // 解析当前帧检测到的每一只手（最多支持 2 只手）
    const parsedHands = result.landmarks.map((rawLandmarks, index) => {
      const handedness = result.handedness?.[index]?.[0]?.categoryName || (index === 0 ? 'Right' : 'Left');
      const classification = this.classifier.classify(rawLandmarks, handedness);

      // 坐标锚点：张开手掌用手掌中心，其余用食指尖
      const targetPoint = classification.isOpenPalm && classification.palmCenter
        ? classification.palmCenter
        : (classification.indexTip || rawLandmarks[8] || rawLandmarks[0]);

      // 镜像映射并独立平滑
      const rawX = (1 - targetPoint.x) * viewport.width;
      const rawY = targetPoint.y * viewport.height;
      const smoother = this.smootherHands[handedness] || this.smoother;
      const smoothedPos = smoother.smooth({ x: rawX, y: rawY });

      const estimatedRadius = classification.palmSize
        ? Math.max(45, Math.min(110, classification.palmSize * viewport.width * 0.35))
        : 60;

      return {
        id: index,
        rawLandmarks,
        handedness, // 'Left' | 'Right'
        classification,
        screenPos: smoothedPos,
        eraserRadius: Math.round(estimatedRadius),
        facing: classification.facing,
      };
    });

    // 主手优先选择右手，若无右手则取第一只手
    const primaryHand = parsedHands.find((h) => h.handedness.toLowerCase() === 'right') || parsedHands[0];

    // 动态动作检测（分析主手的时序动作）
    const motionResult = this.motion.update(primaryHand.rawLandmarks, primaryHand.classification);

    // 双手联合特征计算
    let twoHandsData = null;
    if (parsedHands.length >= 2) {
      const h1 = parsedHands[0];
      const h2 = parsedHands[1];
      const dx = h2.screenPos.x - h1.screenPos.x;
      const dy = h2.screenPos.y - h1.screenPos.y;
      const distance = Math.hypot(dx, dy);
      const center = {
        x: (h1.screenPos.x + h2.screenPos.x) / 2,
        y: (h1.screenPos.y + h2.screenPos.y) / 2,
      };
      twoHandsData = {
        distance,
        center,
        angle: Math.atan2(dy, dx),
      };
    }

    this.lastResult = {
      // 兼容单手调用的主手属性
      rawLandmarks: primaryHand.rawLandmarks,
      classification: primaryHand.classification,
      screenPos: primaryHand.screenPos,
      eraserRadius: primaryHand.eraserRadius,
      handedness: primaryHand.handedness,
      facing: primaryHand.facing,

      // 多手/双手扩展数据
      hands: parsedHands,
      allHandsLandmarks: result.landmarks,
      isTwoHands: parsedHands.length >= 2,
      twoHands: twoHandsData,

      // 动态手势动作
      motionAction: motionResult?.action ?? null,
      motionConfidence: motionResult?.confidence ?? 0,
    };

    return this.lastResult;
  }
}
