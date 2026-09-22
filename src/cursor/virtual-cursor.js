/**
 * 虚拟光标管理器 (VirtualCursor)
 * 支持单手与双手模式，渲染跟随食指位置的微动效光标（右手蓝紫 / 左手粉橙）
 */
export class VirtualCursor {
  constructor(cursorElement) {
    this.cursor1 = cursorElement;
    this.cursor1.classList.add('cursor-primary');
    this.label1 = document.getElementById('cursor-label');

    // 动态克隆生成副光标 (左手)
    let c2 = document.getElementById('virtual-cursor-2');
    if (!c2 && cursorElement?.parentNode) {
      c2 = cursorElement.cloneNode(true);
      c2.id = 'virtual-cursor-2';
      c2.classList.remove('cursor-primary');
      c2.classList.add('cursor-secondary');
      cursorElement.parentNode.appendChild(c2);
    }
    this.cursor2 = c2;
    this.label2 = this.cursor2?.querySelector('.cursor-label');

    // 保持对单光标的兼容引用
    this.cursor = this.cursor1;
    this.label = this.label1;
    this.x = 0;
    this.y = 0;
    this.isPinching1 = false;
    this.isPinching2 = false;
    this.lastHoveredElement = null;
    this.isVisible = false;
  }

  /**
   * 显示或隐藏所有虚拟光标
   */
  setVisible(visible) {
    this.isVisible = visible;
    if (this.cursor1) this.cursor1.style.display = visible ? 'block' : 'none';
    if (this.cursor2 && !visible) this.cursor2.style.display = 'none';
  }

  /**
   * 多手联合更新方法（优先调用）
   * @param {Array} hands 手部对象数组 [{ rawLandmarks, handedness, classification, screenPos, eraserRadius }, ...]
   * @param {string} currentMode 'draw' | 'canvas' | 'select'
   */
  updateMulti(hands, currentMode = 'draw') {
    if (!hands || hands.length === 0) {
      this.setVisible(false);
      return;
    }

    this.setVisible(true);

    if (hands.length === 1) {
      // 单手模式：仅激活主光标，隐藏副光标
      this._updateSingleCursor(this.cursor1, this.label1, hands[0], currentMode, false);
      if (this.cursor2) this.cursor2.style.display = 'none';
    } else {
      // 双手模式：两只光标同时激活
      // 分配右手为主光标，左手为副光标
      const rightHand = hands.find((h) => h.handedness?.toLowerCase() === 'right') || hands[0];
      const leftHand  = hands.find((h) => h !== rightHand) || hands[1];

      this._updateSingleCursor(this.cursor1, this.label1, rightHand, currentMode, true, '右手');
      if (this.cursor2) {
        this.cursor2.style.display = 'block';
        this._updateSingleCursor(this.cursor2, this.label2, leftHand, currentMode, true, '左手');
      }
    }
  }

  /**
   * 单光标更新兼容接口
   */
  update(pos, classification, eraserRadius = 55, currentMode = 'draw') {
    this.updateMulti([{
      screenPos: pos,
      classification,
      eraserRadius,
      handedness: 'Right',
    }], currentMode);
  }

  /**
   * 内部方法：更新单个光标 DOM 的形态与标签
   */
  _updateSingleCursor(cursorEl, labelEl, hand, currentMode, isMultiHand = false, handName = '') {
    if (!cursorEl) return;

    const { screenPos: pos, classification, eraserRadius = 55 } = hand;
    cursorEl.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;

    if (labelEl) {
      const facingTag = classification.facing === 'PALM' ? '·手心' : (classification.facing === 'BACK' ? '·手背' : '');
      const prefix = isMultiHand && handName ? `[${handName}] ` : '';

      const gestureMapByMode = {
        draw: {
          PINCH: '🤏 捏合作画',
          POINTING: '👉 食指悬停',
          FIST: '✊ 握拳暂停',
          OPEN_PALM: '🖐️ 橡皮擦',
          BACK_HAND: '🤚 防误触',
          PEACE: '✌️ 剪刀手',
          TRACKING: '🔍 追踪中',
        },
        canvas: {
          PINCH: '🤏 捏合点击',
          POINTING: '👉 食指悬停',
          FIST: '✊ 握拳暂停',
          OPEN_PALM: '🖐️ 平移画布',
          BACK_HAND: '🤚 防误触',
          PEACE: '✌️ 剪刀手',
          TRACKING: '🔍 追踪中',
        },
        select: {
          PINCH: '🤏 捏合选中',
          POINTING: '👉 食指移动',
          FIST: '✊ 握拳暂停',
          OPEN_PALM: '🖐️ 放开取消',
          BACK_HAND: '🤚 悬停',
          PEACE: '✌️ 剪刀手',
          TRACKING: '🔍 追踪中',
        },
      };
      const map = gestureMapByMode[currentMode] ?? gestureMapByMode.draw;
      const baseText = map[classification.gesture] || classification.gesture;
      labelEl.textContent = `${prefix}${baseText} ${facingTag}`;
    }

    const isPinching = classification.isPinching;
    const isErasing = classification.isOpenPalm && currentMode === 'draw';
    const isPanning = classification.isOpenPalm && currentMode === 'canvas';
    const isSelecting = classification.isPinching && currentMode === 'select';

    cursorEl.classList.remove('erasing', 'pinching', 'panning', 'selecting');

    if (isErasing) {
      cursorEl.classList.add('erasing');
      const ring = cursorEl.querySelector('.cursor-ring');
      if (ring) {
        ring.style.width = `${eraserRadius * 2}px`;
        ring.style.height = `${eraserRadius * 2}px`;
        ring.style.left = `${-eraserRadius + 16}px`;
        ring.style.top = `${-eraserRadius + 16}px`;
      }
    } else {
      const ring = cursorEl.querySelector('.cursor-ring');
      if (ring) {
        ring.style.width = '';
        ring.style.height = '';
        ring.style.left = '';
        ring.style.top = '';
      }

      if (isPanning) cursorEl.classList.add('panning');
      else if (isSelecting) cursorEl.classList.add('selecting');
      else if (isPinching) cursorEl.classList.add('pinching');
    }

    // 仅针对主手执行 UI Hit-test 点击交互
    if (cursorEl === this.cursor1 && !isErasing && !isPanning) {
      const wasPinching = this.isPinching1;
      this.isPinching1 = isPinching;
      this.handleHitTest(pos, wasPinching, isPinching);
    }
  }

  /**
   * 检测当前光标位置下覆盖的 DOM 元素，触发 hover 或点击
   */
  handleHitTest(pos, wasPinching, isPinching) {
    if (!this.cursor1) return;
    this.cursor1.style.pointerEvents = 'none';
    const target = document.elementFromPoint(pos.x, pos.y);
    if (!target) return;

    const clickable = target.closest('button, input[type="range"]');
    if (clickable) {
      if (this.lastHoveredElement !== clickable) {
        if (this.lastHoveredElement) {
          this.lastHoveredElement.classList.remove('gesture-hover');
        }
        clickable.classList.add('gesture-hover');
        this.lastHoveredElement = clickable;
      }

      if (!wasPinching && isPinching) {
        clickable.click();
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
