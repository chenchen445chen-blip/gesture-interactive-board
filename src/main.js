import { CameraManager } from './camera/camera-manager.js';
import { GestureDetector } from './gesture/detector.js';
import { VirtualCursor } from './cursor/virtual-cursor.js';
import { DrawingBoard } from './canvas/drawing-board.js';
import { Toolbar } from './ui/toolbar.js';
import { StatsHud } from './ui/stats-hud.js';
import { Hand3DScene } from './hand3d/hand-scene.js';

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
    this.hand3dCanvas   = document.getElementById('hand-3d-canvas');
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
    this.handStyle          = 'skin'; // 默认：3D 拟真手模 ('skin' | 'model' | 'cyber' | 'skeleton')

    // 核心组件
    this.cameraManager = new CameraManager(this.videoElement);
    this.detector      = new GestureDetector();
    this.drawingBoard  = new DrawingBoard(this.drawingCanvas, this.landmarkCanvas);
    this.virtualCursor = new VirtualCursor(this.cursorElement);
    this.statsHud      = new StatsHud();
    this.hand3d        = new Hand3DScene(this.hand3dCanvas);

    this.toolbar = new Toolbar(this.drawingBoard, {
      onToggleSkeleton: (visible) => {
        this.showSkeleton = visible;
        if (!visible) {
          this.drawingBoard.renderLandmarks([], false);
          this.hand3d.update([], false);
        }
      },
      onHandStyleChange: (style) => {
        this.handStyle = style;
        if (style === 'skeleton') {
          this.hand3d.update([], false);
          this.showToast('已切换至「2D 线框骨骼」');
        } else {
          this.drawingBoard.renderLandmarks([], false);
          this.hand3d.setTheme(style);
          const styleNames = {
            skin: '3D 拟真手模 (PBR 真实皮肤)',
            model: '开源标准 3D 模型 (WebXR GLB)',
            cyber: '赛博机甲 3D 手模',
          };
          this.showToast(`已切换至「${styleNames[style] || style}」`);
        }
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
        this.detector?.motion?.reset();
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

    window.addEventListener('resize', () => {
      this.hand3d.resize(window.innerWidth, window.innerHeight);
    });
  }

  // ═══════════════════════════════════════════════════════
  //  摄像头 FAB
  // ═══════════════════════════════════════════════════════

  initCameraFab() {
    this.fabEl.onclick = () => {
      if (this.isGestureRunning) this.stopGesture();
      else this.startGesture();
    };
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
      // 启动时确保白色画布居中对齐，并保持在画笔作画模式
      this.toolbar.applyMode('draw');
      this.drawingBoard.resetView();
      this.loop();
    } catch (err) {
      console.error('手势识别启动异常:', err);
      this.setFabState('error', err.message || '请检查摄像头权限');
    }
  }

  stopGesture() {
    this.isGestureRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.cameraManager.stopCamera();
    this.drawingBoard.renderLandmarks([], false);
    this.hand3d.update([], false);
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
        const { screenPos, motionAction, hands, isTwoHands } = result;

        // 双光标与手部渲染（根据风格动态路由到 3D WebGL 模型或 2D 线框）
        this.virtualCursor.updateMulti(hands, this.currentMode);
        if (this.handStyle === 'skeleton') {
          this.hand3d.update([], false);
          this.drawingBoard.renderLandmarks(hands, this.showSkeleton, true);
        } else {
          // 主画布渲染 3D 手模，画中画小窗保留辅助骨骼
          this.drawingBoard.renderLandmarks(hands, this.showSkeleton, false);
          this.hand3d.update(hands, this.showSkeleton);
        }

        // ── 根据当前模式分发交互逻辑 ──
        switch (this.currentMode) {
          case 'draw':
            this._handleDrawMode(result);
            break;

          case 'canvas':
            // 彻底去除单手勾手/展开对画布缩放的干扰，缩放完全交由双手手掌控制
            this._handleCanvasMode(result);
            break;

          case 'select':
            this._handleSelectMode(result.classification, screenPos);
            break;
        }
      } else {
        this._onHandLost();
      }
    } catch (err) {
      console.error('推理异常:', err);
    } finally {
      if (this.isGestureRunning) {
        this.rafId = requestAnimationFrame(() => this.loop());
      }
    }
  }

  // ─── 画笔模式 ──────────────────────────────────────────
  _handleDrawMode(result) {
    const { isTwoHands, hands, classification, screenPos, eraserRadius } = result;

    // ── 双手协同绘制 ──
    if (isTwoHands && hands.length >= 2) {
      const rightHand = hands.find((h) => h.handedness?.toLowerCase() === 'right') || hands[0];
      const leftHand  = hands.find((h) => h !== rightHand) || hands[1];

      // 任一手张开手心，触发该手所在位置的橡皮擦
      const erasingHand = [rightHand, leftHand].find((h) => h.classification.isOpenPalm);
      if (erasingHand) {
        if (this.drawingBoard.isDrawing) this.drawingBoard.endStroke();
        this.drawingBoard.eraseArea(erasingHand.screenPos.x, erasingHand.screenPos.y, erasingHand.eraserRadius);
        this.isCurrentlyErasing = true;
        this.statsHud.updateState('OPEN_PALM', `🤲 双手 · ${erasingHand.handedness === 'Left' ? '左手' : '右手'}橡皮擦`, erasingHand.classification.facing);
        return;
      }

      if (this.isCurrentlyErasing) {
        this.isCurrentlyErasing = false;
        this.drawingBoard.saveState();
      }

      // 任一手捏合，由该手执行笔触绘制
      const drawingHand = [rightHand, leftHand].find((h) => h.classification.isPinching);
      if (drawingHand) {
        if (!this.drawingBoard.isDrawing) {
          this.drawingBoard.startStroke(drawingHand.screenPos.x, drawingHand.screenPos.y);
        } else {
          this.drawingBoard.drawTo(drawingHand.screenPos.x, drawingHand.screenPos.y);
        }
        this.statsHud.updateState('PINCH', `🤲 双手 · ${drawingHand.handedness === 'Left' ? '左手' : '右手'}绘制中`, drawingHand.classification.facing);
      } else {
        if (this.drawingBoard.isDrawing) this.drawingBoard.endStroke();
        this.statsHud.updateState('TRACKING', `🤲 双手实时追踪中`, rightHand.classification.facing);
      }
      return;
    }

    // ── 单手模式 ──
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
   * 画布控制模式：
   * 1. 双手握拳 → 停止一切操作（锁定视图）
   * 2. 两手手掌远离 → 放大画布
   * 3. 两手手掌靠近 → 缩小画布
   * 4. 两手手掌协同位移 → 平移画布
   * 5. 单手手掌张开 → 平移画布
   * 6. 单手握拳 → 停止操作 / 暂停
   * （彻底去除单手捏合放大缩小与勾手放大缩小）
   */
  _handleCanvasMode(result) {
    const { isTwoHands, twoHands, hands, classification, screenPos } = result;

    // ── 规则 1：两手握拳 → 立即停止操作 ──
    const isBothFist = isTwoHands && hands.length >= 2 && hands.every((h) => h.classification.gesture === 'FIST');
    if (isBothFist) {
      this.lastTwoHandsDist   = null;
      this.lastTwoHandsCenter = null;
      this.lastPanPos         = null;
      this.isCurrentlyPanning = false;
      this.statsHud.updateState('FIST', '✊ 双手握拳 · 停止操作');
      return;
    }

    // ── 规则 2：双手手掌靠近缩小 / 远离放大 ──
    if (isTwoHands && twoHands) {
      this.lastPanPos = null;
      this.lastPinchRatio = null;

      // 双手手掌间距变化检测
      if (this.lastTwoHandsDist != null) {
        const delta = twoHands.distance - this.lastTwoHandsDist;
        if (Math.abs(delta) > 3) {
          // delta > 0: 双手远离 → 放大画布
          // delta < 0: 双手靠近 → 缩小画布
          const factor = 1 + Math.max(-0.15, Math.min(0.15, delta / 300));
          this.drawingBoard.zoomAt(factor, twoHands.center.x, twoHands.center.y);

          const scalePercent = Math.round(this.drawingBoard.viewScale * 100);
          const statusText = delta > 0
            ? `🤲 两手远离 · 放大 (${scalePercent}%)`
            : `🤲 两手靠近 · 缩小 (${scalePercent}%)`;
          this.statsHud.updateState('TRACKING', statusText);
        }
      }

      // 双手手掌协同平移（当两手间距相对稳定，但整体位置在移动时）
      if (this.lastTwoHandsCenter != null) {
        const panX = twoHands.center.x - this.lastTwoHandsCenter.x;
        const panY = twoHands.center.y - this.lastTwoHandsCenter.y;
        const distChange = this.lastTwoHandsDist != null ? Math.abs(twoHands.distance - this.lastTwoHandsDist) : 0;
        if (Math.hypot(panX, panY) > 3 && distChange < 20) {
          this.drawingBoard.panBy(panX, panY);
        }
      }

      this.lastTwoHandsDist = twoHands.distance;
      this.lastTwoHandsCenter = { ...twoHands.center };
      return;
    }

    // 单手恢复：重置双手记录
    this.lastTwoHandsDist   = null;
    this.lastTwoHandsCenter = null;

    // ── 单手模式（已彻底去除单手放大缩小与勾手缩放） ──
    if (classification.isOpenPalm) {
      // 单手手掌张开 → 平移画布（带死区与单步位移限幅，杜绝甩飞画布）
      if (this.lastPanPos) {
        const rawDx = screenPos.x - this.lastPanPos.x;
        const rawDy = screenPos.y - this.lastPanPos.y;
        if (Math.hypot(rawDx, rawDy) > 4) {
          const clampedDx = Math.max(-28, Math.min(28, rawDx * 0.75));
          const clampedDy = Math.max(-28, Math.min(28, rawDy * 0.75));
          this.drawingBoard.panBy(clampedDx, clampedDy);
        }
      }
      this.lastPanPos     = { x: screenPos.x, y: screenPos.y };
      this.isCurrentlyPanning = true;
      this.statsHud.updateState('OPEN_PALM', '🖐️ 手掌平移画布', classification.facing);

    } else if (classification.gesture === 'FIST') {
      // 单手握拳 → 停止操作
      this.lastPanPos         = null;
      this.isCurrentlyPanning = false;
      this.statsHud.updateState('FIST', '✊ 握拳 · 停止操作', classification.facing);

    } else {
      // 单手悬停或其他手势（单手捏合绝不放大缩小）
      this.lastPanPos         = null;
      this.isCurrentlyPanning = false;
      this.statsHud.updateState(classification.gesture, '🖼️ 画布悬停 (缩放请用双手手掌)', classification.facing);
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
    // 严格限制：仅在画布控制模式下响应画布动态手势
    if (this.currentMode !== 'canvas') return;

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
    this.hand3d.update([], false);
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

// 兼容 DOM 初始加载与 Vite HMR 模块热重载
function initApp() {
  if (window.__gestureAppInstance) {
    try { window.__gestureAppInstance.stopGesture(); } catch (_) {}
  }
  window.__gestureAppInstance = new GestureApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
