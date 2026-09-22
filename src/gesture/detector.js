import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { GestureClassifier } from './classifier.js';
import { CoordinateSmoother } from './filter.js';

/**
 * 手势检测主控制器 (GestureDetector)
 * 负责加载 MediaPipe Tasks Vision 模型、执行帧级推理并输出分类与滤波后的屏幕物理像素坐标
 */
export class GestureDetector {
  constructor() {
    this.handLandmarker = null;
    this.classifier = new GestureClassifier();
    this.smoother = new CoordinateSmoother(0.4);
    this.isReady = false;
    this.lastVideoTime = -1;
    this.lastResult = null;
    this.lostFrameCount = 0;
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
        minHandDetectionConfidence: 0.4, // 适当降低置信度门槛，增强倾斜/边缘抓取能力
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
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
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
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

    // 当在高刷屏幕 (如 Mac ProMotion 120Hz) 下 loop 频率远高于摄像头 30fps 时，复用上一帧有效检测，避免闪烁清屏
    if (videoElement.currentTime === this.lastVideoTime) {
      return this.lastResult;
    }

    this.lastVideoTime = videoElement.currentTime;

    let result = null;
    try {
      result = this.handLandmarker.detectForVideo(videoElement, timestamp);
    } catch (inferErr) {
      console.warn('推理帧跳过:', inferErr);
      return this.lastResult;
    }

    if (!result?.landmarks || result.landmarks.length === 0) {
      this.lostFrameCount++;
      // 短暂丢失 6 帧内（约 100ms）保持上一帧位置，避免手部轻微抖动造成绘制中断
      if (this.lostFrameCount < 6 && this.lastResult) {
        return this.lastResult;
      }
      this.smoother.reset();
      this.lastResult = null;
      return null;
    }

    this.lostFrameCount = 0;

    // 默认追踪第一只检测到的手
    const rawLandmarks = result.landmarks[0];
    const handedness = result.handedness?.[0]?.[0]?.categoryName || 'Right';
    const classification = this.classifier.classify(rawLandmarks, handedness);

    // 坐标锚点选择：张开手掌时使用手掌几何中心作为大面积板擦中心，其余手势使用食指尖
    const targetPoint = classification.isOpenPalm && classification.palmCenter
      ? classification.palmCenter
      : (classification.indexTip || rawLandmarks[8] || rawLandmarks[0]);

    // 屏幕镜像映射转换：
    // 摄像头的 x 是 0(左)~1(右)，因为用户习惯镜像操作，所以 x 坐标做翻转 1 - x
    const rawX = (1 - targetPoint.x) * viewport.width;
    const rawY = targetPoint.y * viewport.height;

    // 平滑滤波，防止细微抖动
    const smoothedPos = this.smoother.smooth({ x: rawX, y: rawY });

    // 计算橡皮擦半径（根据手掌大小动态计算，范围 45px ~ 110px）
    const estimatedRadius = classification.palmSize
      ? Math.max(45, Math.min(110, classification.palmSize * viewport.width * 0.35))
      : 60;

    this.lastResult = {
      rawLandmarks,
      allHandsLandmarks: result.landmarks,
      classification,
      screenPos: smoothedPos,
      eraserRadius: Math.round(estimatedRadius),
      handedness,
      facing: classification.facing,
    };

    return this.lastResult;
  }
}

