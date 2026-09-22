/**
 * 虚拟光标管理器 (VirtualCursor)
 * 渲染跟随食指位置的微动效光标，并在捏合时触发原生 DOM 事件 (click, mousedown, mouseup)
 */
export class VirtualCursor {
  constructor(cursorElement) {
    this.cursor = cursorElement;
    this.label = document.getElementById('cursor-label');
    this.x = 0;
    this.y = 0;
    this.isPinching = false;
    this.lastHoveredElement = null;
    this.isVisible = false;
  }

  /**
   * 显示或隐藏虚拟光标
   */
  setVisible(visible) {
    if (this.isVisible === visible) return;
    this.isVisible = visible;
    this.cursor.style.display = visible ? 'block' : 'none';
  }

  /**
   * 更新光标位置和手势状态
   * @param {{x: number, y: number}} pos 屏幕实际像素坐标
   * @param {Object} classification 分类结果 { gesture, isPinching, isOpenPalm }
   * @param {number} eraserRadius 橡皮擦半径
   */
  update(pos, classification, eraserRadius = 55) {
    this.setVisible(true);
    this.x = pos.x;
    this.y = pos.y;

    // 移动光标 DOM
    this.cursor.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;

    // 更新手势标签文本
    if (this.label) {
      const facingTag = classification.facing === 'PALM' ? ' · 手心' : (classification.facing === 'BACK' ? ' · 手背' : '');
      const gestureMap = {
        PINCH: '🤏 捏合 (下笔/点击)',
        POINTING: '👉 食指指引',
        FIST: '✊ 握拳 (暂停)',
        OPEN_PALM: '🖐️ 橡皮擦 (滑动擦除)',
        BACK_HAND: '🤚 手背朝前 (悬浮)',
        PEACE: '✌️ 剪刀手',
        TRACKING: '🔍 追踪中',
      };
      const baseText = gestureMap[classification.gesture] || classification.gesture;
      this.label.textContent = `${baseText}${facingTag}`;
    }

    const wasPinching = this.isPinching;
    this.isPinching = classification.isPinching;
    const isErasing = classification.isOpenPalm;

    if (isErasing) {
      this.cursor.classList.add('erasing');
      this.cursor.classList.remove('pinching');
      // 动态将橡皮擦环设为手掌擦除范围大小
      const ring = this.cursor.querySelector('.cursor-ring');
      if (ring) {
        ring.style.width = `${eraserRadius * 2}px`;
        ring.style.height = `${eraserRadius * 2}px`;
        ring.style.left = `${-eraserRadius + 16}px`;
        ring.style.top = `${-eraserRadius + 16}px`;
      }
    } else {
      this.cursor.classList.remove('erasing');
      const ring = this.cursor.querySelector('.cursor-ring');
      if (ring) {
        ring.style.width = '';
        ring.style.height = '';
        ring.style.left = '';
        ring.style.top = '';
      }

      if (this.isPinching) {
        this.cursor.classList.add('pinching');
      } else {
        this.cursor.classList.remove('pinching');
      }
    }

    // 仅在非大面积擦除状态时才执行精准的微小按钮悬浮检测
    if (!isErasing) {
      this.handleHitTest(pos, wasPinching, this.isPinching);
    }
  }

  /**
   * 检测当前光标位置下覆盖的 DOM 元素，触发 hover 或点击
   */
  handleHitTest(pos, wasPinching, isPinching) {
    // 隐藏光标自身防止 hit-test 命中光标本身
    this.cursor.style.pointerEvents = 'none';
    const target = document.elementFromPoint(pos.x, pos.y);

    if (!target) return;

    // 寻找可点击元素 (button 或其子项)
    const clickable = target.closest('button, input[type="range"]');

    if (clickable) {
      if (this.lastHoveredElement !== clickable) {
        if (this.lastHoveredElement) {
          this.lastHoveredElement.classList.remove('gesture-hover');
        }
        clickable.classList.add('gesture-hover');
        this.lastHoveredElement = clickable;
      }

      // 当从未捏合变为捏合瞬间，触发一次点击
      if (!wasPinching && isPinching) {
        clickable.click();
        // 增加点击触感动画类
        clickable.classList.add('gesture-active');
        setTimeout(() => clickable.classList.remove('gesture-active'), 180);
      }
    } else {
      if (this.lastHoveredElement) {
        this.lastHoveredElement.classList.remove('gesture-hover');
        this.lastHoveredElement = null;
      }
    }
  }
}
