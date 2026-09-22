/**
 * 画板引擎 (DrawingBoard)
 * 支持平滑手绘曲线、橡皮擦、撤销记录，以及手部骨骼点视觉渲染
 */
export class DrawingBoard {
  constructor(drawCanvas, landmarkCanvas, pipCanvas = null) {
    this.drawCanvas = drawCanvas;
    this.drawCtx = drawCanvas.getContext('2d');

    this.landmarkCanvas = landmarkCanvas;
    this.landmarkCtx = landmarkCanvas.getContext('2d');

    this.pipCanvas = pipCanvas || document.getElementById('pip-canvas');
    this.pipCtx = this.pipCanvas ? this.pipCanvas.getContext('2d') : null;

    // 绘制状态
    this.currentColor = '#3b82f6';
    this.currentSize = 6;
    this.currentTool = 'brush'; // 'brush' | 'pointer' | 'eraser'
    this.isDrawing = false;
    this.lastPoint = null;

    // 画布视角缩放倍率 (支持手势前来放大效果)
    this.currentZoom = 1.0;

    // 撤销历史
    this.history = [];
    this.maxHistory = 20;

    // 骨骼连接拓扑结构
    this.HAND_CONNECTIONS = [
      [0, 1], [1, 2], [2, 3], [3, 4],       // 大拇指
      [0, 5], [5, 6], [6, 7], [7, 8],       // 食指
      [5, 9], [9, 10], [10, 11], [11, 12],  // 中指
      [9, 13], [13, 14], [14, 15], [15, 16],// 无名指
      [13, 17], [17, 18], [18, 19], [19, 20],// 小指
      [0, 17],                              // 掌根连接
    ];

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * 将屏幕坐标根据画布缩放转换为实际像素坐标
   */
  toCanvasCoords(screenX, screenY) {
    if (this.currentZoom === 1.0) return { x: screenX, y: screenY };
    const cx = this.drawCanvas.width / 2;
    const cy = this.drawCanvas.height / 2;
    return {
      x: (screenX - cx) / this.currentZoom + cx,
      y: (screenY - cy) / this.currentZoom + cy,
    };
  }

  /**
   * 放大画布视角（前来拉近效果）
   */
  zoomIn(step = 0.25) {
    this.setZoom(this.currentZoom + step);
  }

  /**
   * 缩小画布视角
   */
  zoomOut(step = 0.25) {
    this.setZoom(this.currentZoom - step);
  }

  /**
   * 重置画布缩放
   */
  resetZoom() {
    this.setZoom(1.0);
  }

  /**
   * 设置画布缩放倍率
   */
  setZoom(zoom) {
    this.currentZoom = Math.max(0.6, Math.min(3.0, Number(zoom.toFixed(2))));
    this.drawCanvas.style.transform = `scale(${this.currentZoom})`;
    this.drawCanvas.style.transformOrigin = 'center center';
    this.drawCanvas.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
  }

  /**
   * 适应视口分辨率调整画布像素
   */
  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // 备份现有图画
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.drawCanvas.width;
    tempCanvas.height = this.drawCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (this.drawCanvas.width > 0) {
      tempCtx.drawImage(this.drawCanvas, 0, 0);
    }

    this.drawCanvas.width = width;
    this.drawCanvas.height = height;
    this.landmarkCanvas.width = width;
    this.landmarkCanvas.height = height;

    // 恢复图画
    if (tempCanvas.width > 0) {
      this.drawCtx.drawImage(tempCanvas, 0, 0);
    }

    this.saveState();
  }

  /**
   * 保存当前画布快照到撤销历史
   */
  saveState() {
    if (this.history.length >= this.maxHistory) {
      this.history.shift();
    }
    this.history.push(
      this.drawCtx.getImageData(0, 0, this.drawCanvas.width, this.drawCanvas.height)
    );
  }

  /**
   * 撤销上一步绘制
   */
  undo() {
    if (this.history.length > 1) {
      this.history.pop(); // 弹出当前状态
      const previousState = this.history[this.history.length - 1];
      this.drawCtx.putImageData(previousState, 0, 0);
    } else if (this.history.length === 1) {
      this.clear();
    }
  }

  /**
   * 清空画布
   */
  clear() {
    this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    this.history = [];
    this.saveState();
  }

  /**
   * 开始一条新线段
   */
  startStroke(screenX, screenY) {
    if (this.currentTool === 'pointer') return;

    const { x, y } = this.toCanvasCoords(screenX, screenY);
    this.isDrawing = true;
    this.lastPoint = { x, y };

    this.drawCtx.beginPath();
    this.drawCtx.moveTo(x, y);
    this.drawCtx.lineCap = 'round';
    this.drawCtx.lineJoin = 'round';
  }

  /**
   * 绘制到目标坐标
   */
  drawTo(screenX, screenY) {
    if (!this.isDrawing || !this.lastPoint || this.currentTool === 'pointer') return;

    const { x, y } = this.toCanvasCoords(screenX, screenY);

    this.drawCtx.save();

    if (this.currentTool === 'eraser') {
      this.drawCtx.globalCompositeOperation = 'destination-out';
      this.drawCtx.lineWidth = (this.currentSize * 2.5) / this.currentZoom;
    } else {
      this.drawCtx.globalCompositeOperation = 'source-over';
      this.drawCtx.strokeStyle = this.currentColor;
      this.drawCtx.lineWidth = this.currentSize / this.currentZoom;
    }

    // 中点二次贝塞尔曲线平滑下笔
    const midX = (this.lastPoint.x + x) / 2;
    const midY = (this.lastPoint.y + y) / 2;

    this.drawCtx.quadraticCurveTo(this.lastPoint.x, this.lastPoint.y, midX, midY);
    this.drawCtx.stroke();

    this.lastPoint = { x, y };
    this.drawCtx.restore();
  }

  /**
   * 结束绘制并保存快照
   */
  endStroke() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.lastPoint = null;
    this.saveState();
  }

  /**
   * 像真实黑板擦一样擦除圆形区域
   * @param {number} screenX 屏幕中心坐标 X
   * @param {number} screenY 屏幕中心坐标 Y
   * @param {number} radius 橡皮擦半径
   */
  eraseArea(screenX, screenY, radius = 55) {
    const { x, y } = this.toCanvasCoords(screenX, screenY);
    const canvasRadius = radius / this.currentZoom;

    this.drawCtx.save();
    this.drawCtx.globalCompositeOperation = 'destination-out';
    this.drawCtx.beginPath();
    this.drawCtx.arc(x, y, canvasRadius, 0, Math.PI * 2);
    this.drawCtx.fill();
    this.drawCtx.restore();
  }

  /**
   * 渲染手部 21 个骨骼点与连接线
   * @param {Array<{x: number, y: number}>} landmarks 归一化关键点
   * @param {boolean} visible 是否显示
   */
  renderLandmarks(landmarks, visible = true) {
    this.landmarkCtx.clearRect(0, 0, this.landmarkCanvas.width, this.landmarkCanvas.height);

    if (this.pipCtx && this.pipCanvas) {
      if (this.pipCanvas.width !== this.pipCanvas.clientWidth && this.pipCanvas.clientWidth > 0) {
        this.pipCanvas.width = this.pipCanvas.clientWidth;
        this.pipCanvas.height = this.pipCanvas.clientHeight;
      }
      this.pipCtx.clearRect(0, 0, this.pipCanvas.width, this.pipCanvas.height);
    }

    if (!visible || !landmarks || landmarks.length < 21) return;

    // 1. 渲染主画布全屏骨骼
    this.drawSkeletonOnCtx(this.landmarkCtx, landmarks, this.landmarkCanvas.width, this.landmarkCanvas.height);

    // 2. 渲染画中画小窗骨骼 (更直观确认手势追踪)
    if (this.pipCtx && this.pipCanvas && this.pipCanvas.width > 0) {
      this.drawSkeletonOnCtx(this.pipCtx, landmarks, this.pipCanvas.width, this.pipCanvas.height, 0.7);
    }
  }

  /**
   * 在指定 Context 上绘制骨骼线与关节点
   */
  drawSkeletonOnCtx(ctx, landmarks, width, height, scale = 1.0) {
    const points = landmarks.map((pt) => ({
      x: (1 - pt.x) * width,
      y: pt.y * height,
    }));

    ctx.save();

    // 绘制连线
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.75)';
    ctx.lineWidth = 2.5 * scale;

    for (const [startIdx, endIdx] of this.HAND_CONNECTIONS) {
      const p1 = points[startIdx];
      const p2 = points[endIdx];
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // 绘制关节节点
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      ctx.beginPath();

      if (i === 8) {
        // 食指尖点高亮
        ctx.arc(p.x, p.y, 7 * scale, 0, Math.PI * 2);
        ctx.fillStyle = '#06b6d4';
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 10 * scale;
      } else if (i === 4) {
        // 大拇指尖点
        ctx.arc(p.x, p.y, 6 * scale, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.shadowBlur = 0;
      } else {
        ctx.arc(p.x, p.y, 3.5 * scale, 0, Math.PI * 2);
        ctx.fillStyle = '#e0e7ff';
        ctx.shadowBlur = 0;
      }

      ctx.fill();
    }

    ctx.restore();
  }
}
