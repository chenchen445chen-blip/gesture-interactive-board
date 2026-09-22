/**
 * 坐标滤波平滑器 (CoordinateSmoother)
 * 采用指数移动平均 (EMA) 与动态速率自适应算法，消除摄像头手部追踪时的细微颤抖
 */
export class CoordinateSmoother {
  constructor(alpha = 0.45) {
    this.alpha = alpha; // 平滑因子：数值越大响应越快，数值越小越平滑
    this.lastPoint = null;
  }

  /**
   * 重置平滑器状态
   */
  reset() {
    this.lastPoint = null;
  }

  /**
   * 平滑单个 2D 坐标点
   * @param {{x: number, y: number}} current 当前采样点
   * @returns {{x: number, y: number}} 平滑后的点
   */
  smooth(current) {
    if (!this.lastPoint) {
      this.lastPoint = { ...current };
      return { ...current };
    }

    // 动态调整 alpha：当大幅度快速移动时，降低平滑度增强响应速度
    const dx = current.x - this.lastPoint.x;
    const dy = current.y - this.lastPoint.y;
    const dist = Math.hypot(dx, dy);

    // 速度感知因子 (当移动距离大时自适应提高 alpha 减少拖拽延迟)
    const dynamicAlpha = Math.min(1.0, Math.max(this.alpha, dist * 0.05));

    const smoothedX = this.lastPoint.x + dynamicAlpha * (current.x - this.lastPoint.x);
    const smoothedY = this.lastPoint.y + dynamicAlpha * (current.y - this.lastPoint.y);

    this.lastPoint = { x: smoothedX, y: smoothedY };
    return { x: smoothedX, y: smoothedY };
  }
}
