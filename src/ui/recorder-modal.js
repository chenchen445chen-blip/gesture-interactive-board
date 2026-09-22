/**
 * 手势录制与工坊面板 (RecorderModal)
 */
export class RecorderModal {
  constructor(gestureRecorder, onActionTrigger) {
    this.recorder = gestureRecorder;
    this.onActionTrigger = onActionTrigger;

    this.modalEl = document.getElementById('recorder-modal');
    this.btnOpen = document.getElementById('btn-open-recorder');
    this.btnClose = document.getElementById('btn-close-recorder');

    this.btnStartRecord = document.getElementById('btn-start-record');
    this.recordNameInput = document.getElementById('record-gesture-name');
    this.recordActionSelect = document.getElementById('record-gesture-action');
    this.recordStatusText = document.getElementById('record-status-text');
    this.recordProgressBar = document.getElementById('record-progress-bar');
    this.gestureListContainer = document.getElementById('recorded-gesture-list');

    this.initEvents();
    this.renderList();
  }

  initEvents() {
    if (this.btnOpen) {
      this.btnOpen.addEventListener('click', () => this.open());
    }
    if (this.btnClose) {
      this.btnClose.addEventListener('click', () => this.close());
    }

    if (this.btnStartRecord) {
      this.btnStartRecord.addEventListener('click', () => this.handleStartRecord());
    }
  }

  open() {
    this.modalEl.classList.remove('hidden');
    this.renderList();
  }

  close() {
    this.modalEl.classList.add('hidden');
  }

  handleStartRecord() {
    const name = this.recordNameInput.value.trim() || '自定义手势';
    const action = this.recordActionSelect.value || 'zoom_in';

    this.btnStartRecord.disabled = true;
    this.btnStartRecord.textContent = '准备录制... 保持手势';
    this.recordStatusText.textContent = '请在摄像头前摆好手势（如：勾手姿态）... 3秒后开始';
    this.recordStatusText.className = 'record-status recording';

    let countdown = 3;
    const timer = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        this.recordStatusText.textContent = `倒计时 ${countdown} 秒，请保持手势稳定...`;
      } else {
        clearInterval(timer);
        this.recordStatusText.textContent = '正在捕捉手部关节点特征 (约1.8秒)... 请保持手势不动！';
        this.btnStartRecord.textContent = '录制中...';

        this.recorder.startRecording(
          name,
          action,
          (progress) => {
            if (this.recordProgressBar) {
              this.recordProgressBar.style.width = `${progress * 100}%`;
            }
          },
          (newGesture, errMsg) => {
            this.btnStartRecord.disabled = false;
            this.btnStartRecord.textContent = '重新录制当前手势';
            if (this.recordProgressBar) {
              this.recordProgressBar.style.width = '0%';
            }

            if (errMsg) {
              this.recordStatusText.textContent = `❌ 录制失败: ${errMsg}`;
              this.recordStatusText.className = 'record-status error';
            } else {
              this.recordStatusText.textContent = `✅ 录制成功！手势 [${newGesture.name}] 已保存并生效`;
              this.recordStatusText.className = 'record-status success';
              this.renderList();
            }
          }
        );
      }
    }, 1000);
  }

  renderList() {
    if (!this.gestureListContainer) return;

    const gestures = this.recorder.gestures;
    if (gestures.length === 0) {
      this.gestureListContainer.innerHTML = `
        <div class="empty-hint">暂无已录制的手势，输入名称并点击上方按钮开始录制。</div>
      `;
      return;
    }

    const actionNames = {
      zoom_in: '🔍 画布拉近放大 (前来放大)',
      zoom_out: '🔎 画布缩小视角',
      reset_view: '🔄 重置画布视角',
      undo: '↩️ 撤销上一笔',
      clear: '🗑️ 一键清空画布',
      cycle_color: '🎨 轮换画笔颜色',
    };

    this.gestureListContainer.innerHTML = gestures
      .map(
        (g) => `
        <div class="gesture-item" id="item-${g.id}">
          <div class="item-info">
            <span class="item-name">✨ ${g.name}</span>
            <span class="item-action">${actionNames[g.action] || g.action}</span>
            <span class="item-time">${g.createdAt || ''}</span>
          </div>
          <div class="item-actions">
            <span class="match-badge" id="match-${g.id}">就绪</span>
            <button class="btn-del-gesture" data-id="${g.id}">删除</button>
          </div>
        </div>
      `
      )
      .join('');

    // 绑定删除按钮
    this.gestureListContainer.querySelectorAll('.btn-del-gesture').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        this.recorder.deleteGesture(id);
        this.renderList();
      });
    });
  }

  /**
   * 实时高亮当前匹配的手势
   */
  highlightMatch(gestureId, similarity) {
    const badge = document.getElementById(`match-${gestureId}`);
    if (badge) {
      badge.textContent = `匹配度 ${(similarity * 100).toFixed(0)}%`;
      badge.classList.add('active');
      setTimeout(() => badge.classList.remove('active'), 800);
    }
  }
}
