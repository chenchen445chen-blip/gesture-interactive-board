/**
 * 画板引擎 (DrawingBoard) - Photoshop 风格无限画布
 *
 * 坐标系说明：
 *  - 文档坐标系 (Document Space)：画布内容固定尺寸 CANVAS_W × CANVAS_H
 *  - 屏幕坐标系 (Screen Space)：浏览器视口像素坐标
 *  - 视图变换：screen = doc × viewScale + [viewX, viewY]
 *              doc   = (screen - [viewX, viewY]) / viewScale
 *
 * #canvas-inner CSS: transform = translate(viewX, viewY) scale(viewScale)，transform-origin: 0 0
 * #landmark-canvas 固定在视口（不受视图变换影响），骨骼直接画在屏幕坐标
 */
export class DrawingBoard {
  constructor(drawCanvas, landmarkCanvas) {
    this.drawCanvas = drawCanvas;
    this.drawCtx    = drawCanvas.getContext('2d');

    this.landmarkCanvas = landmarkCanvas;
    this.landmarkCtx    = landmarkCanvas.getContext('2d');

    this.pipCanvas = document.getElementById('pip-canvas');
    this.pipCtx    = this.pipCanvas ? this.pipCanvas.getContext('2d') : null;

    // PS 风格可变换容器
    this.canvasInner = document.getElementById('canvas-inner');

    // ── 文档尺寸（固定，决定画板内容区域） ──────────────────
    this.CANVAS_W = 2400;
    this.CANVAS_H = 1600;

    // ── 视图变换状态 ──────────────────────────────────────
    this.viewX     = 0;    // 平移偏移 X（屏幕像素）
    this.viewY     = 0;    // 平移偏移 Y
    this.viewScale = 1.0;  // 缩放倍率

    // ── 绘制状态 ──────────────────────────────────────────
    this.currentColor = '#3b82f6';
    this.currentSize  = 6;
    this.currentTool  = 'brush'; // 'brush' | 'eraser'
    this.isDrawing    = false;
    this.lastPoint    = null;

    // ── 撤销历史 ──────────────────────────────────────────
    this.history    = [];
    this.maxHistory = 30;

    // ── 手骨拓扑 ──────────────────────────────────────────
    this.HAND_CONNECTIONS = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20],
      [0, 17],
    ];

    this._initCanvas();
    this._centerView();
    this.applyViewTransform();

    window.addEventListener('resize', () => this._resizeLandmarkCanvas());
  }

  // ═══════════════════════════════════════════════════════
  //  初始化
  // ═══════════════════════════════════════════════════════

  _initCanvas() {
    // 文档画布使用固定尺寸
    this.drawCanvas.width  = this.CANVAS_W;
    this.drawCanvas.height = this.CANVAS_H;
    this._resizeLandmarkCanvas();
    this.saveState();
  }

  /** landmark canvas 跟随视口大小（在屏幕坐标绘骨骼，不参与视图变换） */
  _resizeLandmarkCanvas() {
    this.landmarkCanvas.width  = window.innerWidth;
    this.landmarkCanvas.height = window.innerHeight;
  }

  /** 将画布居中并以合适缩放填充视口（首次 + resetView 调用） */
  _centerView() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fitScale = Math.min((vw * 0.82) / this.CANVAS_W, (vh * 0.82) / this.CANVAS_H, 1.0);
    this.viewScale = parseFloat(fitScale.toFixed(3));
    this.viewX = (vw - this.CANVAS_W * this.viewScale) / 2;
    this.viewY = (vh - this.CANVAS_H * this.viewScale) / 2;
  }

  // ═══════════════════════════════════════════════════════
  //  视图变换
  // ═══════════════════════════════════════════════════════

  applyViewTransform(animated = false) {
    if (!this.canvasInner) return;
    this.canvasInner.style.transition = animated
      ? 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)'
      : 'none';
    this.canvasInner.style.transform =
      `translate(${this.viewX}px, ${this.viewY}px) scale(${this.viewScale})`;
    this._updateZoomUI();
  }

  _updateZoomUI() {
    const el = document.getElementById('zoom-indicator');
    if (el) el.textContent = `${Math.round(this.viewScale * 100)}%`;
  }

  /** 屏幕坐标 → 文档坐标 */
  screenToCanvas(sx, sy) {
    return {
      x: (sx - this.viewX) / this.viewScale,
      y: (sy - this.viewY) / this.viewScale,
    };
  }

  /** 文档坐标 → 屏幕坐标 */
  canvasToScreen(cx, cy) {
    return {
      x: cx * this.viewScale + this.viewX,
      y: cy * this.viewScale + this.viewY,
    };
  }

  /**
   * 平移画布
   * @param {number} dx 屏幕像素增量 X
   * @param {number} dy 屏幕像素增量 Y
   */
  panBy(dx, dy) {
    this.viewX += dx;
    this.viewY += dy;
    this.applyViewTransform();
  }

  /**
   * 以指定屏幕坐标为中心缩放（Photoshop 光标中心缩放）
   * @param {number} factor 缩放系数（> 1 放大，< 1 缩小）
   * @param {number} screenX 缩放中心屏幕 X
   * @param {number} screenY 缩放中心屏幕 Y
   */
  zoomAt(factor, screenX, screenY) {
    const newScale = Math.max(0.05, Math.min(16.0, this.viewScale * factor));
    // 保持光标下的文档点不变
    const cx = (screenX - this.viewX) / this.viewScale;
    const cy = (screenY - this.viewY) / this.viewScale;
    this.viewX = screenX - cx * newScale;
    this.viewY = screenY - cy * newScale;
    this.viewScale = newScale;
    this.applyViewTransform();
  }

  zoomIn(step = 0.2, sx, sy) {
    this.zoomAt(1 + step, sx ?? window.innerWidth / 2, sy ?? window.innerHeight / 2);
  }

  zoomOut(step = 0.2, sx, sy) {
    this.zoomAt(1 / (1 + step), sx ?? window.innerWidth / 2, sy ?? window.innerHeight / 2);
  }

  /** 重置视图：居中 + 自适应缩放 */
  resetView() {
    this._centerView();
    this.applyViewTransform(true);
  }

  // ═══════════════════════════════════════════════════════
  //  绘制操作（所有坐标自动 screen → doc 转换）
  // ═══════════════════════════════════════════════════════

  startStroke(screenX, screenY) {
    const { x, y } = this.screenToCanvas(screenX, screenY);
    this.isDrawing = true;
    this.lastPoint = { x, y };

    this.drawCtx.beginPath();
    this.drawCtx.moveTo(x, y);
    this.drawCtx.lineCap  = 'round';
    this.drawCtx.lineJoin = 'round';
  }

  drawTo(screenX, screenY) {
    if (!this.isDrawing || !this.lastPoint) return;
    const { x, y } = this.screenToCanvas(screenX, screenY);

    this.drawCtx.save();
    if (this.currentTool === 'eraser') {
      this.drawCtx.globalCompositeOperation = 'destination-out';
      this.drawCtx.lineWidth = this.currentSize * 2.5;
    } else {
      this.drawCtx.globalCompositeOperation = 'source-over';
      this.drawCtx.strokeStyle = this.currentColor;
      this.drawCtx.lineWidth   = this.currentSize;
    }

    // 贝塞尔平滑
    const midX = (this.lastPoint.x + x) / 2;
    const midY = (this.lastPoint.y + y) / 2;
    this.drawCtx.quadraticCurveTo(this.lastPoint.x, this.lastPoint.y, midX, midY);
    this.drawCtx.stroke();

    this.lastPoint = { x, y };
    this.drawCtx.restore();
  }

  endStroke() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.lastPoint = null;
    this.saveState();
  }

  /**
   * 橡皮擦：圆形区域擦除（屏幕坐标 → 文档坐标，半径同步换算）
   * @param {number} radius 屏幕像素半径
   */
  eraseArea(screenX, screenY, radius = 55) {
    const { x, y } = this.screenToCanvas(screenX, screenY);
    const docRadius = radius / this.viewScale;
    this.drawCtx.save();
    this.drawCtx.globalCompositeOperation = 'destination-out';
    this.drawCtx.beginPath();
    this.drawCtx.arc(x, y, docRadius, 0, Math.PI * 2);
    this.drawCtx.fill();
    this.drawCtx.restore();
  }

  // ═══════════════════════════════════════════════════════
  //  历史 / 状态
  // ═══════════════════════════════════════════════════════

  saveState() {
    if (this.history.length >= this.maxHistory) this.history.shift();
    this.history.push(
      this.drawCtx.getImageData(0, 0, this.CANVAS_W, this.CANVAS_H)
    );
  }

  undo() {
    if (this.history.length > 1) {
      this.history.pop();
      this.drawCtx.putImageData(this.history[this.history.length - 1], 0, 0);
    } else {
      this.clear();
    }
  }

  clear() {
    this.drawCtx.clearRect(0, 0, this.CANVAS_W, this.CANVAS_H);
    this.history = [];
    this.saveState();
  }

  // ═══════════════════════════════════════════════════════
  //  骨骼渲染（固定在屏幕坐标，不受视图变换影响）
  // ═══════════════════════════════════════════════════════

  renderLandmarks(landmarks, visible = true) {
    this.landmarkCtx.clearRect(0, 0, this.landmarkCanvas.width, this.landmarkCanvas.height);

    if (this.pipCtx && this.pipCanvas) {
      const pw = this.pipCanvas.clientWidth;
      if (pw > 0 && this.pipCanvas.width !== pw) {
        this.pipCanvas.width  = pw;
        this.pipCanvas.height = this.pipCanvas.clientHeight;
      }
      this.pipCtx.clearRect(0, 0, this.pipCanvas.width, this.pipCanvas.height);
    }

    if (!visible || !landmarks || landmarks.length < 21) return;

    this.drawSkeletonOnCtx(
      this.landmarkCtx, landmarks,
      this.landmarkCanvas.width, this.landmarkCanvas.height
    );

    if (this.pipCtx && this.pipCanvas?.width > 0) {
      this.drawSkeletonOnCtx(
        this.pipCtx, landmarks,
        this.pipCanvas.width, this.pipCanvas.height, 0.7
      );
    }
  }

  drawSkeletonOnCtx(ctx, landmarks, width, height, scale = 1.0) {
    const pts = landmarks.map((pt) => ({
      x: (1 - pt.x) * width,
      y: pt.y * height,
    }));

    ctx.save();
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.75)';
    ctx.lineWidth   = 2.5 * scale;

    for (const [a, b] of this.HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
      ctx.stroke();
    }

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.beginPath();
      if (i === 8) {
        ctx.arc(p.x, p.y, 7 * scale, 0, Math.PI * 2);
        ctx.fillStyle   = '#06b6d4';
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur  = 10 * scale;
      } else if (i === 4) {
        ctx.arc(p.x, p.y, 6 * scale, 0, Math.PI * 2);
        ctx.fillStyle  = '#f59e0b';
        ctx.shadowBlur = 0;
      } else {
        ctx.arc(p.x, p.y, 3.5 * scale, 0, Math.PI * 2);
        ctx.fillStyle  = '#e0e7ff';
        ctx.shadowBlur = 0;
      }
      ctx.fill();
    }

    ctx.restore();
  }
}
