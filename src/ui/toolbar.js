/**
 * 工具栏与操作面板控制器 (Toolbar)
 */
export class Toolbar {
  constructor(drawingBoard, options = {}) {
    this.drawingBoard = drawingBoard;
    this.options = options;

    this.showCamera = false;
    this.showSkeleton = true;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.toolButtons = document.querySelectorAll('.tool-btn');
    this.colorButtons = document.querySelectorAll('.color-btn');
    this.sizeInput = document.getElementById('brush-size');
    this.sizeDisplay = document.getElementById('brush-size-display');

    this.btnUndo = document.getElementById('btn-undo');
    this.btnClear = document.getElementById('btn-clear');
    this.btnToggleCamera = document.getElementById('btn-toggle-camera');
    this.btnToggleSkeleton = document.getElementById('btn-toggle-skeleton');

    this.videoContainer = document.getElementById('video-container');
    this.guideCard = document.querySelector('.gesture-guide-card');
    this.btnCloseGuide = document.getElementById('btn-close-guide');
  }

  bindEvents() {
    // 切换工具 (画笔 / 指针 / 橡皮擦)
    this.toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.toolButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.drawingBoard.currentTool = btn.dataset.tool;
      });
    });

    // 颜色选择
    this.colorButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.colorButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.drawingBoard.currentColor = btn.dataset.color;
      });
    });

    // 笔刷大小
    this.sizeInput.addEventListener('input', (e) => {
      const val = e.target.value;
      this.sizeDisplay.textContent = `${val}px`;
      this.drawingBoard.currentSize = Number(val);
    });

    // 撤销与清空
    this.btnUndo.addEventListener('click', () => this.drawingBoard.undo());
    this.btnClear.addEventListener('click', () => this.drawingBoard.clear());

    // 摄像头预览切换
    this.btnToggleCamera.addEventListener('click', () => {
      this.showCamera = !this.showCamera;
      this.videoContainer.classList.toggle('hidden', !this.showCamera);
      this.btnToggleCamera.classList.toggle('active', this.showCamera);
    });

    // 骨骼点可视化切换
    this.btnToggleSkeleton.addEventListener('click', () => {
      this.showSkeleton = !this.showSkeleton;
      this.btnToggleSkeleton.classList.toggle('active', this.showSkeleton);
      if (this.options.onToggleSkeleton) {
        this.options.onToggleSkeleton(this.showSkeleton);
      }
    });

    // 关闭操作指南卡片
    if (this.btnCloseGuide) {
      this.btnCloseGuide.addEventListener('click', () => {
        this.guideCard.style.display = 'none';
      });
    }
  }
}
