import { CameraManager } from './camera/camera-manager.js';
import { GestureDetector } from './gesture/detector.js';
import { GestureRecorder } from './gesture/gesture-recorder.js';
import { VirtualCursor } from './cursor/virtual-cursor.js';
import { DrawingBoard } from './canvas/drawing-board.js';
import { Toolbar } from './ui/toolbar.js';
import { StatsHud } from './ui/stats-hud.js';
import { RecorderModal } from './ui/recorder-modal.js';

/**
 * 手势交互画板主应用程序
 */
class GestureApp {
  constructor() {
    this.videoElement = document.getElementById('webcam-video');
    this.drawingCanvas = document.getElementById('drawing-canvas');
    this.landmarkCanvas = document.getElementById('landmark-canvas');
    this.cursorElement = document.getElementById('virtual-cursor');

    this.startOverlay = document.getElementById('start-overlay');
    this.btnStart = document.getElementById('btn-start');
    this.loadingSpinner = document.getElementById('loading-spinner');
    this.loadingMsg = document.getElementById('loading-msg');

    this.toastEl = document.getElementById('action-toast');
    this.toastText = document.getElementById('toast-text');
    this.toastTimer = null;

    // 初始化核心组件
    this.cameraManager = new CameraManager(this.videoElement);
    this.detector = new GestureDetector();
    this.recorder = new GestureRecorder();
    this.drawingBoard = new DrawingBoard(this.drawingCanvas, this.landmarkCanvas);
    this.virtualCursor = new VirtualCursor(this.cursorElement);
    this.statsHud = new StatsHud();

    this.recorderModal = new RecorderModal(this.recorder, (action) => {
      this.executeGestureAction(action, '测试触发');
    });

    this.showSkeleton = true;
    this.isRunning = false;
    this.isCurrentlyErasing = false;

    this.toolbar = new Toolbar(this.drawingBoard, {
      onToggleSkeleton: (visible) => {
        this.showSkeleton = visible;
        if (!visible) {
          this.drawingBoard.renderLandmarks([], false);
        }
      },
    });

    this.initEventListeners();
  }

  initEventListeners() {
    // 启动按钮点击
    this.btnStart.addEventListener('click', () => this.startApplication());

    // 鼠标备用兜底支持（即便不开启手势，亦可用鼠标测试画板）
    this.initMouseFallback();
  }

  async startApplication() {
    this.btnStart.style.display = 'none';
    this.loadingSpinner.classList.remove('hidden');

    try {
      // 1. 初始化手势识别模型
      await this.detector.init((msg) => {
        if (this.loadingMsg) this.loadingMsg.textContent = msg;
      });

      // 2. 启动摄像头
      if (this.loadingMsg) this.loadingMsg.textContent = '正在获取摄像头权限...';
      await this.cameraManager.startCamera();

      // 3. 隐藏启动遮罩并进入交互主循环
      this.startOverlay.classList.add('hidden');
      this.isRunning = true;
      this.statsHud.updateState('TRACKING', '实时追踪中');

      this.loop();
    } catch (err) {
      console.error('应用启动异常:', err);
      if (this.loadingMsg) {
        this.loadingMsg.textContent = `启动失败: ${err.message || '请检查摄像头权限或网络'}`;
      }
      this.btnStart.style.display = 'inline-flex';
    }
  }

  /**
   * 动画推理与交互调度主循环
   */
  loop() {
    if (!this.isRunning) return;

    this.statsHud.tick();

    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    const now = performance.now();

    try {
      const result = this.detector.detectFrame(this.videoElement, now, viewport);

      if (result) {
        const { rawLandmarks, classification, screenPos, eraserRadius } = result;

        // 1. 更新虚拟光标（手掌模式自动放大为擦除圆盘）
        this.virtualCursor.update(screenPos, classification, eraserRadius);

        // 2. 渲染手势骨骼连线
        this.drawingBoard.renderLandmarks(rawLandmarks, this.showSkeleton);

        // 3. 手势逻辑调度：手掌张开左右滑动作为橡皮擦，食指捏合作为画笔/点击
        if (classification.isOpenPalm) {
          // 停止画笔下笔
          if (this.drawingBoard.isDrawing) {
            this.drawingBoard.endStroke();
          }
          // 执行手掌中心区域擦除
          this.drawingBoard.eraseArea(screenPos.x, screenPos.y, eraserRadius);
          this.isCurrentlyErasing = true;
          this.statsHud.updateState('OPEN_PALM', '🖐️ 手掌橡皮擦擦除中', classification.facing);
        } else {
          // 若刚才在擦除，现在离开手掌模式，则保存一步撤销快照
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
            this.statsHud.updateState('PINCH', '下笔绘制中', classification.facing);
          } else if (classification.gesture === 'BACK_HAND') {
            if (this.drawingBoard.isDrawing) {
              this.drawingBoard.endStroke();
            }
            this.statsHud.updateState('BACK_HAND', '手背朝前 (防误触悬停)', classification.facing);
          } else {
            if (this.drawingBoard.isDrawing) {
              this.drawingBoard.endStroke();
            }
            this.statsHud.updateState(classification.gesture, '追踪稳定', classification.facing);
          }
        }

        // 4. 自定义录制手势（如勾手放大等）实时匹配与事件派发
        const customResult = this.recorder.match(rawLandmarks, (matchedGesture) => {
          this.executeGestureAction(matchedGesture.action, matchedGesture.name);
          this.recorderModal.highlightMatch(matchedGesture.id, 1.0);
        });

        if (customResult?.matched) {
          const matchPercent = (customResult.similarity * 100).toFixed(0);
          this.statsHud.updateState(
            `✨ ${customResult.matched.name}`,
            `匹配度 ${matchPercent}%`,
            classification.facing
          );
        }
      } else {
        // 手部离开视野
        if (this.drawingBoard.isDrawing) {
          this.drawingBoard.endStroke();
        }
        if (this.isCurrentlyErasing) {
          this.isCurrentlyErasing = false;
          this.drawingBoard.saveState();
        }
        this.drawingBoard.renderLandmarks([], false);
        this.virtualCursor.setVisible(false);
        this.statsHud.updateState('UNKNOWN', '等待手部进入视野', 'UNKNOWN');
      }
    } catch (loopErr) {
      console.error('交互主循环执行异常:', loopErr);
    } finally {
      requestAnimationFrame(() => this.loop());
    }
  }

  /**
   * 触发执行手势绑定的动作并弹出视效提示
   */
  executeGestureAction(action, gestureName = '') {
    switch (action) {
      case 'zoom_in':
        this.drawingBoard.zoomIn(0.25);
        this.showToast(`🔍 触发手势 [${gestureName}]：画布前来放大至 ${(this.drawingBoard.currentZoom * 100).toFixed(0)}%`);
        break;
      case 'zoom_out':
        this.drawingBoard.zoomOut(0.25);
        this.showToast(`🔎 触发手势 [${gestureName}]：画布缩小至 ${(this.drawingBoard.currentZoom * 100).toFixed(0)}%`);
        break;
      case 'reset_view':
        this.drawingBoard.resetZoom();
        this.showToast(`🔄 触发手势 [${gestureName}]：已重置画布为 100% 视角`);
        break;
      case 'undo':
        this.drawingBoard.undo();
        this.showToast(`↩️ 触发手势 [${gestureName}]：已撤销上一笔`);
        break;
      case 'clear':
        this.drawingBoard.clear();
        this.showToast(`🗑️ 触发手势 [${gestureName}]：已清空全屏画布`);
        break;
      case 'cycle_color':
        const colorBtns = Array.from(document.querySelectorAll('.color-btn'));
        const activeIdx = colorBtns.findIndex((b) => b.classList.contains('active'));
        const nextBtn = colorBtns[(activeIdx + 1) % colorBtns.length];
        if (nextBtn) nextBtn.click();
        this.showToast(`🎨 触发手势 [${gestureName}]：已切换画笔颜色`);
        break;
    }
  }

  /**
   * 屏幕顶部微动效提示
   */
  showToast(text) {
    if (this.toastEl && this.toastText) {
      this.toastText.textContent = text;
      this.toastEl.classList.remove('hidden');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.toastEl.classList.add('hidden');
      }, 1800);
    }
  }


  /**
   * 鼠标/触控板备用交互
   */
  initMouseFallback() {
    let isMouseDown = false;

    this.drawingCanvas.addEventListener('mousedown', (e) => {
      isMouseDown = true;
      this.drawingBoard.startStroke(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      if (isMouseDown) {
        this.drawingBoard.drawTo(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', () => {
      if (isMouseDown) {
        isMouseDown = false;
        this.drawingBoard.endStroke();
      }
    });
  }
}

// 实例化并启动引导
window.addEventListener('DOMContentLoaded', () => {
  new GestureApp();
});
