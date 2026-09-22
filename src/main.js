import { CameraManager } from './camera/camera-manager.js';
import { GestureDetector } from './gesture/detector.js';
import { VirtualCursor } from './cursor/virtual-cursor.js';
import { DrawingBoard } from './canvas/drawing-board.js';
import { Toolbar } from './ui/toolbar.js';
import { StatsHud } from './ui/stats-hud.js';

/**
 * 手势交互画板主应用程序
 *
 * 交互模式：
 *  draw   - 捏合=绘制 | 手掌=橡皮擦
 *  canvas - 手掌=平移 | 捏合=缩放（捏合距离变化） | 握拳=复位视图
 *  select - 食指=悬停 | 捏合=选中
 *
 * 通用导航（任意模式）：
 *  滚轮      → 以光标为中心缩放
 *  中键拖拽  → 平移画布
 *  0         → 重置视图
 *  + / -     → 缩放
 *  方向键     → 平移
 */
class GestureApp {
  constructor() {
    this.videoElement   = document.getElementById('webcam-video');
    this.drawingCanvas  = document.getElementById('drawing-canvas');
    this.landmarkCanvas = document.getElementById('landmark-canvas');
    this.cursorElement  = document.getElementById('virtual-cursor');
    this.toastEl        = document.getElementById('action-toast');
    this.toastText      = document.getElementById('toast-text');
    this.toastTimer     = null;

    // FAB 元素
    this.fabEl         = document.getElementById('camera-fab');
    this.fabTitle      = document.getElementById('fab-title');
    this.fabSub        = document.getElementById('fab-sub');
    this.fabLoadingEl  = document.getElementById('fab-loading');
    this.fabLoadingMsg = document.getElementById('fab-loading-msg');

    // 运行状态
    this.isGestureRunning   = false;
    this.isCurrentlyErasing = false;
    this.isCurrentlyPanning = false;
    this.lastPanPos         = null;
    this.lastPinchRatio     = null; // 用于画布控制模式捏合缩放
    this.currentMode        = 'draw';
    this.showSkeleton       = true;

    // 核心组件
    this.cameraManager = new CameraManager(this.videoElement);
    this.detector      = new GestureDetector();
    this.drawingBoard  = new DrawingBoard(this.drawingCanvas, this.landmarkCanvas);
    this.virtualCursor = new VirtualCursor(this.cursorElement);
    this.statsHud      = new StatsHud();

    this.toolbar = new Toolbar(this.drawingBoard, {
      onToggleSkeleton: (visible) => {
        this.showSkeleton = visible;
        if (!visible) this.drawingBoard.renderLandmarks([], false);
      },
      onModeChange: (mode) => {
        this.currentMode = mode;
        if (this.drawingBoard.isDrawing) this.drawingBoard.endStroke();
        if (this.isCurrentlyErasing) {
          this.isCurrentlyErasing = false;
          this.drawingBoard.saveState();
        }
        this.isCurrentlyPanning = false;
        this.lastPanPos         = null;
        this.lastPinchRatio     = null;
        const modeName = document.querySelector(`.mode-btn[data-mode="${mode}"] .mode-name`)?.textContent ?? mode;
        this.showToast(`已切换至「${modeName}」模式`);
      },
    });

    // 重置视图按钮
    document.getElementById('btn-reset-view')?.addEventListener('click', () => {
      this.drawingBoard.resetView();
    });

    this.initCameraFab();
    this.initMouseAndWheel();
    this.initKeyboardShortcuts();
  }

  // ═══════════════════════════════════════════════════════
  //  摄像头 FAB
  // ═══════════════════════════════════════════════════════

  initCameraFab() {
    this.fabEl.addEventListener('click', () => {
      if (this.isGestureRunning) this.stopGesture();
      else this.startGesture();
    });
  }

  setFabState(state, msg = '') {
    this.fabEl.classList.remove('fab-state-idle', 'fab-state-loading', 'fab-state-running', 'fab-state-error');
    this.fabEl.classList.add(`fab-state-${state}`);

    if (state === 'idle') {
      this.fabTitle.textContent = '开启手势';
      this.fabSub.textContent   = '点击启动摄像头';
      this.fabLoadingEl.classList.add('hidden');
    } else if (state === 'loading') {
      this.fabTitle.textContent          = '启动中...';
      this.fabSub.textContent            = msg;
      this.fabLoadingEl.classList.remove('hidden');
      this.fabLoadingMsg.textContent     = msg;
    } else if (state === 'running') {
      this.fabTitle.textContent = '手势运行中';
      this.fabSub.textContent   = '点击停止';
      this.fabLoadingEl.classList.add('hidden');
    } else if (state === 'error') {
      this.fabTitle.textContent = '启动失败';
      this.fabSub.textContent   = msg || '点击重试';
      this.fabLoadingEl.classList.add('hidden');
    }
  }

  // ═══════════════════════════════════════════════════════
  //  手势识别启停
  // ═══════════════════════════════════════════════════════

  async startGesture() {
    this.setFabState('loading', '正在初始化模型...');
    try {
      await this.detector.init((msg) => this.setFabState('loading', msg));
      this.setFabState('loading', '正在获取摄像头权限...');
      await this.cameraManager.startCamera();
      this.isGestureRunning = true;
      this.setFabState('running');
      this.statsHud.updateState('TRACKING', '实时追踪中');
      this.loop();
    } catch (err) {
      console.error('手势识别启动异常:', err);
      this.setFabState('error', err.message || '请检查摄像头权限');
    }
  }

  stopGesture() {
    this.isGestureRunning = false;
    this.cameraManager.stopCamera();
    this.drawingBoard.renderLandmarks([], false);
    this.virtualCursor.setVisible(false);
    this.statsHud.updateState('UNKNOWN', '手势已停止');
    this.setFabState('idle');
    this.showToast('手势识别已停止');
  }

  // ═══════════════════════════════════════════════════════
  //  手势推理主循环
  // ═══════════════════════════════════════════════════════

  loop() {
    if (!this.isGestureRunning) return;
    this.statsHud.tick();

    try {
      const result = this.detector.detectFrame(
        this.videoElement, performance.now(),
        { width: window.innerWidth, height: window.innerHeight }
      );

      if (result) {
        const { rawLandmarks, classification, screenPos, eraserRadius, motionAction } = result;
        this.virtualCursor.update(screenPos, classification, eraserRadius, this.currentMode);
        this.drawingBoard.renderLandmarks(rawLandmarks, this.showSkeleton);

        // ── 动态手势动作（优先于静态模式处理） ──
        if (motionAction) {
          this._handleMotionAction(motionAction, screenPos);
        } else {
          switch (this.currentMode) {
            case 'draw':   this._handleDrawMode(classification, screenPos, eraserRadius); break;
            case 'canvas': this._handleCanvasMode(classification, screenPos); break;
            case 'select': this._handleSelectMode(classification, screenPos); break;
          }
        }
      } else {
        this._onHandLost();
      }
    } catch (err) {
      console.error('推理异常:', err);
    } finally {
      requestAnimationFrame(() => this.loop());
    }
  }

  // ─── 画笔模式 ──────────────────────────────────────────
  _handleDrawMode(classification, screenPos, eraserRadius) {
    if (classification.isOpenPalm) {
      if (this.drawingBoard.isDrawing) this.drawingBoard.endStroke();
      this.drawingBoard.eraseArea(screenPos.x, screenPos.y, eraserRadius);
      this.isCurrentlyErasing = true;
      this.statsHud.updateState('OPEN_PALM', '🖐️ 画笔 · 橡皮擦', classification.facing);
    } else {
      if (this.isCurrentlyErasing) {
        this.isCurrentlyErasing = false;
        this.drawingBoard.saveState();
      }
      if (classification.isPinching) {
        if (!this.drawingBoard.isDrawing) {
          this.drawingBoard.startStroke(screenPos.x, screenPos.y);
        } else {
          this.drawingBoard.drawTo(screenPos.x, screenPos.y);
        }
        this.statsHud.updateState('PINCH', '✏️ 画笔 · 绘制中', classification.facing);
      } else {
        if (this.drawingBoard.isDrawing) this.drawingBoard.endStroke();
        this.statsHud.updateState(classification.gesture, '✏️ 画笔 · 悬停', classification.facing);
      }
    }
  }

  // ─── 画布控制模式 ─────────────────────────────────────
  /**
   * 手掌张开 → 平移画布（追踪手掌帧间位移）
   * 捏合     → 缩放（追踪 pinchRatio 帧间变化量）
   * 握拳     → 复位视图
   */
  _handleCanvasMode(classification, screenPos) {
    if (classification.isOpenPalm) {
      // 手掌 → 平移
      if (this.lastPanPos) {
        this.drawingBoard.panBy(
          screenPos.x - this.lastPanPos.x,
          screenPos.y - this.lastPanPos.y
        );
      }
      this.lastPanPos     = { x: screenPos.x, y: screenPos.y };
      this.lastPinchRatio = null;
      this.isCurrentlyPanning = true;
      this.statsHud.updateState('OPEN_PALM', '🖼️ 画布 · 平移', classification.facing);

    } else if (classification.isPinching) {
      // 捏合 → 缩放（pinchRatio 越小 = 捏得越紧 = 放大）
      this.lastPanPos = null;
      const pr = classification.pinchRatio;
      if (pr != null && this.lastPinchRatio != null) {
        const delta = this.lastPinchRatio - pr; // 正值=越捏越紧=放大
        if (Math.abs(delta) > 0.006) {
          // 灵敏度 × 3，clamp 避免过激跳变
          const factor = 1 + Math.max(-0.08, Math.min(0.08, delta * 3));
          this.drawingBoard.zoomAt(factor, screenPos.x, screenPos.y);
        }
      }
      this.lastPinchRatio = pr;
      this.isCurrentlyPanning = false;
      this.statsHud.updateState('PINCH', '🖼️ 画布 · 缩放', classification.facing);

    } else if (classification.gesture === 'FIST') {
      // 握拳 → 复位
      this.drawingBoard.resetView();
      this.lastPanPos     = null;
      this.lastPinchRatio = null;
      this.statsHud.updateState('FIST', '🖼️ 画布 · 视图复位', classification.facing);
      this.showToast('视图已复位');

    } else {
      this.lastPanPos     = null;
      this.lastPinchRatio = null;
      this.isCurrentlyPanning = false;
      this.statsHud.updateState(classification.gesture, '🖼️ 画布 · 悬停', classification.facing);
    }
  }

  // ─── 指针模式 ──────────────────────────────────────────
  _handleSelectMode(classification, screenPos) {
    if (classification.isPinching) {
      this.statsHud.updateState('PINCH', '🖱️ 指针 · 选中', classification.facing);
      this._simulateClick(screenPos.x, screenPos.y);
    } else if (classification.isOpenPalm) {
      this.statsHud.updateState('OPEN_PALM', '🖱️ 指针 · 取消', classification.facing);
    } else {
      this.statsHud.updateState(classification.gesture, '🖱️ 指针 · 移动', classification.facing);
    }
  }

  // ─── 动态手势动作分发 ──────────────────────────────────
  /**
   * 根据 MotionDetector 识别出的动作执行对应画布操作
   * 所有模式均响应（动态动作优先级高于静态模式）
   */
  _handleMotionAction(action, screenPos) {
    const cx = screenPos?.x ?? window.innerWidth / 2;
    const cy = screenPos?.y ?? window.innerHeight / 2;

    const ACTION_MAP = {
      // 四指往前勾 → 放大画布（以手所在位置为中心）
      CURL_IN:     { label: '🤏 四指勾入 → 放大',   fn: () => this.drawingBoard.zoomIn(0.35, cx, cy) },
      // 四指往外展 → 缩小画布
      CURL_OUT:    { label: '🖐️ 四指展开 → 缩小',   fn: () => this.drawingBoard.zoomOut(0.35, cx, cy) },
      // 向左滑动 → 画布右移（内容向右）
      SWIPE_LEFT:  { label: '👈 向左滑 → 画布右移',  fn: () => this.drawingBoard.panBy(200, 0) },
      // 向右滑动 → 画布左移
      SWIPE_RIGHT: { label: '👉 向右滑 → 画布左移',  fn: () => this.drawingBoard.panBy(-200, 0) },
      // 向上滑动 → 画布下移
      SWIPE_UP:    { label: '👆 向上滑 → 画布下移',  fn: () => this.drawingBoard.panBy(0, 180) },
      // 向下滑动 → 画布上移
      SWIPE_DOWN:  { label: '👇 向下滑 → 画布上移',  fn: () => this.drawingBoard.panBy(0, -180) },
    };

    const entry = ACTION_MAP[action];
    if (!entry) return;

    entry.fn();
    this.showToast(entry.label);
    this.statsHud.updateState(action, entry.label);
  }

  // ─── 手部离开 ──────────────────────────────────────────
  _onHandLost() {

    if (this.drawingBoard.isDrawing) this.drawingBoard.endStroke();
    if (this.isCurrentlyErasing) {
      this.isCurrentlyErasing = false;
      this.drawingBoard.saveState();
    }
    this.isCurrentlyPanning = false;
    this.lastPanPos         = null;
    this.lastPinchRatio     = null;
    this.drawingBoard.renderLandmarks([], false);
    this.virtualCursor.setVisible(false);
    this.statsHud.updateState('UNKNOWN', '等待手部进入视野', 'UNKNOWN');
  }

  _simulateClick(x, y) {
    const target = document.elementFromPoint(x, y);
    if (target && target !== this.landmarkCanvas) {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    }
  }

  // ═══════════════════════════════════════════════════════
  //  鼠标 + 滚轮 + 中键平移
  // ═══════════════════════════════════════════════════════

  initMouseAndWheel() {
    const viewport = document.getElementById('canvas-viewport');

    // 滚轮 → 缩放（以光标位置为中心）
    viewport?.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.drawingBoard.zoomAt(factor, e.clientX, e.clientY);
    }, { passive: false });

    // 左键拖拽（画笔模式=绘制，画布模式=平移）
    let isLDragging = false;
    let lastLPos    = null;

    viewport?.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isLDragging = true;
      lastLPos = { x: e.clientX, y: e.clientY };
      if (this.currentMode === 'draw' && !this.isGestureRunning) {
        this.drawingBoard.startStroke(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!isLDragging || !lastLPos) return;
      if (this.currentMode === 'draw' && !this.isGestureRunning) {
        this.drawingBoard.drawTo(e.clientX, e.clientY);
      } else if (this.currentMode === 'canvas') {
        this.drawingBoard.panBy(
          e.clientX - lastLPos.x,
          e.clientY - lastLPos.y
        );
      }
      lastLPos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (isLDragging && this.currentMode === 'draw' && !this.isGestureRunning) {
        this.drawingBoard.endStroke();
      }
      isLDragging = false;
      lastLPos = null;
    });

    // 中键拖拽 → 任意模式下平移
    let isMidPan  = false;
    let lastMidPos = null;

    window.addEventListener('mousedown', (e) => {
      if (e.button === 1) { e.preventDefault(); isMidPan = true; lastMidPos = { x: e.clientX, y: e.clientY }; }
    });
    window.addEventListener('mousemove', (e) => {
      if (!isMidPan || !lastMidPos) return;
      this.drawingBoard.panBy(e.clientX - lastMidPos.x, e.clientY - lastMidPos.y);
      lastMidPos = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) { isMidPan = false; lastMidPos = null; }
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ═══════════════════════════════════════════════════════
  //  键盘快捷键
  // ═══════════════════════════════════════════════════════

  initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case '=': case '+': // 放大
          this.drawingBoard.zoomIn(0.2);
          break;
        case '-': case '_': // 缩小
          this.drawingBoard.zoomOut(0.2);
          break;
        case '0': // 复位视图
          this.drawingBoard.resetView();
          this.showToast('视图已复位');
          break;
        case 'ArrowLeft':
          this.drawingBoard.panBy(80, 0); break;
        case 'ArrowRight':
          this.drawingBoard.panBy(-80, 0); break;
        case 'ArrowUp':
          this.drawingBoard.panBy(0, 80); break;
        case 'ArrowDown':
          this.drawingBoard.panBy(0, -80); break;
        case 'z': case 'Z':
          if (e.ctrlKey || e.metaKey) this.drawingBoard.undo(); break;
      }
    });
  }

  // ═══════════════════════════════════════════════════════
  //  Toast
  // ═══════════════════════════════════════════════════════

  showToast(text) {
    if (!this.toastEl || !this.toastText) return;
    this.toastText.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), 1800);
  }
}

window.addEventListener('DOMContentLoaded', () => new GestureApp());
