/**
 * 动态手势动作检测器 (MotionDetector)
 *
 * 原理：维护关键点的滑动时序窗口，通过分析帧间的方向、速度和幅度
 * 识别"有意义的动作"（而非静态手型）。
 *
 * 支持的动作：
 *  - CURL_IN   : 四指往前/内勾（伸直→弯曲），触发：放大画布
 *  - CURL_OUT  : 四指往外展开（弯曲→伸直），触发：缩小画布
 *  - SWIPE_LEFT : 手快速向左平移，触发：画布向左平移
 *  - SWIPE_RIGHT: 手快速向右平移，触发：画布向右平移
 *  - SWIPE_UP  : 手快速向上平移，触发：画布向上平移
 *  - SWIPE_DOWN : 手快速向下平移，触发：画布向下平移
 */
export class MotionDetector {
  constructor(options = {}) {
    // 时序窗口大小（帧数）
    this.windowSize = options.windowSize ?? 12;
    // 动作冷却时间（ms），防止重复触发
    this.cooldownMs = options.cooldownMs ?? 900;

    // 每帧的关键点快照队列
    this.frameBuffer = [];
    // 上次各动作的触发时间
    this.lastTriggerTime = {};

    // 检测阈值
    this.CURL_FLEX_THRESHOLD   = 0.22;  // 四指弯曲变化阈值（归一化）
    this.SWIPE_DIST_THRESHOLD  = 0.18;  // 滑动最小位移（归一化）
    this.SWIPE_SPEED_THRESHOLD = 0.012; // 每帧最小速度（归一化/帧）
  }

  /**
   * 每帧调用，推入最新 landmarks
   * @param {Array} landmarks  MediaPipe 归一化关键点数组 (21点)
   * @param {Object} classification 当前帧静态分类结果
   * @returns {{ action: string|null, confidence: number }}
   */
  update(landmarks, classification) {
    if (!landmarks || landmarks.length < 21) return { action: null };

    // 提取本帧特征快照
    const snap = this._extractSnapshot(landmarks, classification);
    this.frameBuffer.push(snap);
    if (this.frameBuffer.length > this.windowSize) {
      this.frameBuffer.shift();
    }

    // 至少积累半个窗口后才检测
    if (this.frameBuffer.length < Math.ceil(this.windowSize / 2)) {
      return { action: null };
    }

    // 按优先级依次检测
    return (
      this._detectCurl()   ||
      this._detectSwipe()  ||
      { action: null }
    );
  }

  /** 重置缓冲（模式切换/手部消失时调用） */
  reset() {
    this.frameBuffer = [];
  }

  // ═══════════════════════════════════════════════════════
  //  特征提取
  // ═══════════════════════════════════════════════════════

  _extractSnapshot(landmarks, classification) {
    const wrist    = landmarks[0];
    const indexTip = landmarks[8];
    const indexPip = landmarks[6];
    const midTip   = landmarks[12];
    const midPip   = landmarks[10];
    const ringTip  = landmarks[16];
    const ringPip  = landmarks[14];
    const pinkyTip = landmarks[20];
    const pinkyPip = landmarks[18];

    // 四指（食指/中指/无名指/小指）的弯曲度：
    // tipY - pipY，正值=指尖比关节高（弯曲），负值=伸展
    const fingerCurl = [
      indexTip.y - indexPip.y,
      midTip.y   - midPip.y,
      ringTip.y  - ringPip.y,
      pinkyTip.y - pinkyPip.y,
    ];
    const avgCurl = fingerCurl.reduce((a, b) => a + b, 0) / 4;

    // 手掌中心位置（用于滑动检测）
    const palmX = wrist.x;
    const palmY = wrist.y;

    return {
      t: performance.now(),
      avgCurl,        // 四指平均弯曲度（越大=越弯曲）
      palmX,          // 手腕 X（0~1，归一化）
      palmY,          // 手腕 Y
      gesture: classification?.gesture,
      isPinching: classification?.isPinching,
    };
  }

  // ═══════════════════════════════════════════════════════
  //  勾手/展开动作检测 (CURL_IN / CURL_OUT)
  // ═══════════════════════════════════════════════════════

  /**
   * CURL_IN  (勾入): avgCurl 从负/小 → 大幅增大 (手指从伸直往前弯曲)
   * CURL_OUT (展开): avgCurl 从大 → 大幅减小 (手指从弯曲往外伸展)
   */
  _detectCurl() {
    if (this.frameBuffer.length < 6) return null;

    const buf  = this.frameBuffer;
    const head = buf.slice(0, 3);   // 最早几帧
    const tail = buf.slice(-3);     // 最新几帧

    const headCurl = this._avg(head.map(f => f.avgCurl));
    const tailCurl = this._avg(tail.map(f => f.avgCurl));
    const delta    = tailCurl - headCurl;   // 正=越来越弯曲

    // 排除：捏合状态下不检测勾手（避免误触）
    const isPinchActive = tail.some(f => f.isPinching);
    if (isPinchActive) return null;

    if (delta > this.CURL_FLEX_THRESHOLD) {
      return this._trigger('CURL_IN', 0.7 + Math.min(0.3, delta));
    }
    if (delta < -this.CURL_FLEX_THRESHOLD) {
      return this._trigger('CURL_OUT', 0.7 + Math.min(0.3, -delta));
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════
  //  滑动动作检测 (SWIPE_*)
  // ═══════════════════════════════════════════════════════

  _detectSwipe() {
    if (this.frameBuffer.length < 5) return null;

    const buf   = this.frameBuffer;
    const first = buf[0];
    const last  = buf[buf.length - 1];

    const dx = last.palmX - first.palmX;  // 正=向右（屏幕）
    const dy = last.palmY - first.palmY;  // 正=向下
    const dt = (last.t - first.t) || 1;
    const frames = buf.length;

    const speedX = Math.abs(dx) / frames;
    const speedY = Math.abs(dy) / frames;

    // 水平滑动优先
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > this.SWIPE_DIST_THRESHOLD) {
      if (speedX > this.SWIPE_SPEED_THRESHOLD) {
        // 摄像头 x 轴已镜像：dx > 0 是手向左移动（镜像后）
        const action = dx > 0 ? 'SWIPE_LEFT' : 'SWIPE_RIGHT';
        return this._trigger(action, Math.min(1, speedX * 50));
      }
    }

    // 垂直滑动
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > this.SWIPE_DIST_THRESHOLD) {
      if (speedY > this.SWIPE_SPEED_THRESHOLD) {
        const action = dy > 0 ? 'SWIPE_DOWN' : 'SWIPE_UP';
        return this._trigger(action, Math.min(1, speedY * 50));
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════
  //  工具方法
  // ═══════════════════════════════════════════════════════

  /**
   * 触发动作（带冷却）
   * @returns {{ action: string, confidence: number }} | null
   */
  _trigger(action, confidence = 1.0) {
    const now  = performance.now();
    const last = this.lastTriggerTime[action] ?? 0;
    if (now - last < this.cooldownMs) return null;

    this.lastTriggerTime[action] = now;
    // 触发后清空缓冲，防止同一个动作连续触发
    this.frameBuffer = [];

    return { action, confidence };
  }

  _avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
}
