/**
 * 工具栏与交互模式控制器 (Toolbar)
 *
 * 模式说明：
 *  - draw   (画笔模式)  : 捏合=下笔画线 | 手掌张开=橡皮擦
 *  - canvas (画布控制)  : 捏合=点击/确认 | 手掌张开=平移画布
 *  - select (指针模式)  : 食指指引光标 | 捏合=选中操作
 */

const MODE_GUIDE = {
  draw: {
    title: '📖 画笔模式手势',
    items: [
      '<strong>🤏 捏合</strong>：下笔作画',
      '<strong>☝️ 单食指伸出</strong>：悬停移动光标',
      '<strong>🖐️ 手掌张开 (手心朝前)</strong>：橡皮擦大面积擦除',
      '<strong>🤚 手背朝前</strong>：防误触悬停',
      '<strong>✊ 握拳</strong>：暂停绘制',
    ],
    badgePinch: '🤏 捏合→作画',
    badgePalm: '🖐️ 手掌→橡皮擦',
    hudLabel: '画笔',
  },
  canvas: {
    title: '🖼️ 画布控制模式',
    items: [
      '<strong>🤙 四指勾入 (往前勾手)</strong>：以当前手势位置放大画布',
      '<strong>🖐️ 四指外展</strong>：缩小画布',
      '<strong>🖐️ 展掌移动</strong>：连续拖拽平移画布',
      '<strong>👈👉 快速挥动</strong>：向指定方向滑动画布',
      '<strong>✊ 握拳</strong>：一键复位视图 (100% 居中)',
      '<strong>🤏 捏合</strong>：点击 / 确认',
    ],
    badgePinch: '🤙 勾手→放大',
    badgePalm: '🖐️ 掌移→平移',
    hudLabel: '画布控制',
  },
  select: {
    title: '🖱️ 指针模式手势',
    items: [
      '<strong>☝️ 食指移动</strong>：移动光标（不画线）',
      '<strong>🤏 捏合</strong>：悬停选中 / 点击',
      '<strong>🖐️ 手掌张开</strong>：放开 / 取消',
      '<strong>✊ 握拳</strong>：暂停',
    ],
    badgePinch: '🤏 捏合→选中',
    badgePalm: '🖐️ 手掌→取消',
    hudLabel: '指针',
  },
};

export class Toolbar {
  constructor(drawingBoard, options = {}) {
    this.drawingBoard = drawingBoard;
    this.options = options;

    this.showCamera = false;
    this.showSkeleton = true;
    this.currentMode = 'draw'; // 'draw' | 'canvas' | 'select'

    this.initElements();
    this.bindEvents();
    this.applyMode('draw');
  }

  initElements() {
    this.modeBtns    = document.querySelectorAll('.mode-btn');
    this.toolButtons = document.querySelectorAll('.tool-btn');
    this.colorButtons= document.querySelectorAll('.color-btn');
    this.sizeInput   = document.getElementById('brush-size');
    this.sizeDisplay = document.getElementById('brush-size-display');

    this.btnUndo          = document.getElementById('btn-undo');
    this.btnClear         = document.getElementById('btn-clear');
    this.btnResetView     = document.getElementById('btn-reset-view');
    this.btnToggleCamera  = document.getElementById('btn-toggle-camera');
    this.btnToggleSkeleton= document.getElementById('btn-toggle-skeleton');

    this.videoContainer = document.getElementById('video-container');
    this.guideCard      = document.getElementById('gesture-guide-card');
    this.guideTitle     = document.getElementById('guide-title');
    this.guideList      = document.getElementById('guide-list');
    this.btnCloseGuide  = document.getElementById('btn-close-guide');

    this.badgePinch  = document.getElementById('badge-pinch');
    this.badgePalm   = document.getElementById('badge-palm');
    this.hudModeVal  = document.getElementById('hud-mode');
  }

  bindEvents() {
    // 模式切换
    this.modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => this.applyMode(btn.dataset.mode));
    });

    // 绘图子工具
    this.toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.toolButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.drawingBoard.currentTool = btn.dataset.tool;
      });
    });

    // 颜色
    this.colorButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.colorButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.drawingBoard.currentColor = btn.dataset.color;
      });
    });

    // 粗细
    this.sizeInput.addEventListener('input', (e) => {
      const val = e.target.value;
      this.sizeDisplay.textContent = `${val}px`;
      this.drawingBoard.currentSize = Number(val);
    });

    // 撤销 / 清空 / 复位视图
    this.btnUndo.addEventListener('click', () => this.drawingBoard.undo());
    this.btnClear.addEventListener('click', () => this.drawingBoard.clear());
    this.btnResetView?.addEventListener('click', () => {
      this.drawingBoard.resetView();
    });

    // 摄像头预览
    this.btnToggleCamera.addEventListener('click', () => {
      this.showCamera = !this.showCamera;
      this.videoContainer.classList.toggle('hidden', !this.showCamera);
      this.btnToggleCamera.classList.toggle('active', this.showCamera);
    });

    // 骨骼显示
    this.btnToggleSkeleton.addEventListener('click', () => {
      this.showSkeleton = !this.showSkeleton;
      this.btnToggleSkeleton.classList.toggle('active', this.showSkeleton);
      if (this.options.onToggleSkeleton) this.options.onToggleSkeleton(this.showSkeleton);
    });

    // 关闭操作指南
    if (this.btnCloseGuide) {
      this.btnCloseGuide.addEventListener('click', () => {
        this.guideCard.style.display = 'none';
      });
    }
  }


  /**
   * 切换交互模式并同步所有 UI 状态
   */
  applyMode(mode) {
    if (!MODE_GUIDE[mode]) return;
    this.currentMode = mode;

    // 更新模式按钮激活状态
    this.modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));

    // 画笔子工具与颜色板仅在 draw 模式下可见
    const isDrawMode = mode === 'draw';
    document.querySelectorAll('.draw-only').forEach((el) => {
      el.classList.toggle('mode-hidden', !isDrawMode);
    });

    // 更新手势说明卡片
    const guide = MODE_GUIDE[mode];
    this.guideTitle.textContent = guide.title;
    this.guideList.innerHTML = guide.items.map((item) => `<li>${item}</li>`).join('');

    // 更新模式徽标
    this.badgePinch.textContent = guide.badgePinch;
    this.badgePalm.textContent = guide.badgePalm;

    // 更新 HUD 模式值
    if (this.hudModeVal) this.hudModeVal.textContent = guide.hudLabel;

    // 给 app-container 标记当前模式 class（供 CSS 细调光标）
    const appEl = document.getElementById('app');
    appEl.dataset.mode = mode;

    // 通知主应用切换模式
    if (this.options.onModeChange) {
      this.options.onModeChange(mode);
    }
  }
}
