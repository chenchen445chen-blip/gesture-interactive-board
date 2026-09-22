/**
 * 实时状态与帧率 HUD (StatsHud)
 */
export class StatsHud {
  constructor() {
    this.fpsEl = document.getElementById('hud-fps');
    this.gestureEl = document.getElementById('hud-gesture');
    this.facingEl = document.getElementById('hud-facing');
    this.statusEl = document.getElementById('hud-status');

    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fps = 0;
  }

  /**
   * 帧率更新
   */
  tick() {
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastTime;

    if (elapsed >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      if (this.fpsEl) {
        this.fpsEl.textContent = this.fps;
      }
      this.frameCount = 0;
      this.lastTime = now;
    }
  }

  /**
   * 更新当前识别手势、朝向与运行状态
   */
  updateState(gestureName, statusText = '追踪中', facing = 'UNKNOWN') {
    if (this.gestureEl) {
      const labels = {
        PINCH: '🤏 捏合 (点击/画图)',
        POINTING: '👉 食指指引',
        FIST: '✊ 握拳 (暂停)',
        OPEN_PALM: '🖐️ 手心张开 (橡皮擦)',
        BACK_HAND: '🤚 手背朝前 (悬浮)',
        PEACE: '✌️ 剪刀手',
        TRACKING: '🔍 追踪中',
        UNKNOWN: '❓ 未检测到手势',
      };
      this.gestureEl.textContent = labels[gestureName] || gestureName;
    }

    if (this.facingEl) {
      if (facing === 'PALM') {
        this.facingEl.textContent = '🖐️ 手心朝向 (Palm)';
        this.facingEl.style.color = '#34d399';
      } else if (facing === 'BACK') {
        this.facingEl.textContent = '🤚 手背朝向 (Back)';
        this.facingEl.style.color = '#f59e0b';
      } else {
        this.facingEl.textContent = '--';
        this.facingEl.style.color = '';
      }
    }

    if (this.statusEl) {
      this.statusEl.textContent = statusText;
    }
  }
}
