/**
 * 自定义手势录制与特征匹配器 (GestureRecorder)
 * 支持录制任意自定义手势姿态（如勾手、比心、OK、点赞等），通过手掌归一化特征向量进行动态匹配，并执行绑定的事件
 */
export class GestureRecorder {
  constructor(options = {}) {
    this.storageKey = 'custom_recorded_gestures_v1';
    this.gestures = this.loadGestures();

    this.isRecording = false;
    this.recordingFrames = [];
    this.recordingDuration = 1800; // 录制 1.8 秒内手势姿态特征
    this.recordStartTime = 0;
    this.onRecordProgress = null;
    this.onRecordComplete = null;

    this.lastTriggerTimes = new Map(); // 防抖冷却时间戳
    this.triggerCooldown = 600; // 动作触发防抖 600ms
    this.matchThreshold = 0.82; // 匹配相似度门槛 (82% 以上)
  }

  /**
   * 提取手部特征向量（平移无关、尺度归一化）
   * 以 0 号手腕为原点，以手腕到 9 号中指掌骨长度为标准尺
   * @param {Array<{x: number, y: number, z: number}>} landmarks
   * @returns {Array<{x: number, y: number, z: number}>|null}
   */
  extractFeatureVector(landmarks) {
    if (!landmarks || landmarks.length < 21) return null;

    const wrist = landmarks[0];
    const middleMcp = landmarks[9];
    const scale = Math.hypot(
      middleMcp.x - wrist.x,
      middleMcp.y - wrist.y,
      (middleMcp.z || 0) - (wrist.z || 0)
    ) || 0.1;

    // 将 21 个点转换为手腕相对坐标并除以手掌尺度
    return landmarks.map((pt) => ({
      x: (pt.x - wrist.x) / scale,
      y: (pt.y - wrist.y) / scale,
      z: ((pt.z || 0) - (wrist.z || 0)) / scale,
    }));
  }

  /**
   * 开始录制新姿态
   * @param {string} name 手势名称
   * @param {string} actionId 绑定的动作类型
   * @param {Function} onProgress 进度回调 (0 ~ 1)
   * @param {Function} onComplete 录制完成回调 (gestureObj)
   */
  startRecording(name, actionId, onProgress, onComplete) {
    this.isRecording = true;
    this.recordingFrames = [];
    this.recordingName = name || '自定义手势';
    this.recordingAction = actionId || 'zoom_in';
    this.recordStartTime = performance.now();
    this.onRecordProgress = onProgress;
    this.onRecordComplete = onComplete;
  }

  /**
   * 逐帧收集录制特征
   * @param {Array<{x: number, y: number, z: number}>} rawLandmarks
   */
  feedFrame(rawLandmarks) {
    if (!this.isRecording) return;

    const feature = this.extractFeatureVector(rawLandmarks);
    if (feature) {
      this.recordingFrames.push(feature);
    }

    const elapsed = performance.now() - this.recordStartTime;
    const progress = Math.min(1, elapsed / this.recordingDuration);

    if (this.onRecordProgress) {
      this.onRecordProgress(progress);
    }

    if (progress >= 1) {
      this.finishRecording();
    }
  }

  /**
   * 结束录制并计算手势平均模板
   */
  finishRecording() {
    this.isRecording = false;

    if (this.recordingFrames.length === 0) {
      if (this.onRecordComplete) this.onRecordComplete(null, '未采样到有效手部动作');
      return;
    }

    // 均值聚类生成手部姿态模板
    const template = [];
    const count = this.recordingFrames.length;

    for (let i = 0; i < 21; i++) {
      let sumX = 0, sumY = 0, sumZ = 0;
      for (const frame of this.recordingFrames) {
        sumX += frame[i].x;
        sumY += frame[i].y;
        sumZ += frame[i].z;
      }
      template.push({
        x: sumX / count,
        y: sumY / count,
        z: sumZ / count,
      });
    }

    const newGesture = {
      id: `gesture_${Date.now()}`,
      name: this.recordingName,
      action: this.recordingAction,
      template,
      createdAt: new Date().toLocaleTimeString(),
    };

    this.gestures.push(newGesture);
    this.saveGestures();

    if (this.onRecordComplete) {
      this.onRecordComplete(newGesture);
    }
  }

  /**
   * 计算当前手势与模板的相似度 (0 ~ 1)
   * 基于对应 21 关节点的空间距离差求相似度
   */
  computeSimilarity(currentFeature, template) {
    if (!currentFeature || !template) return 0;

    let totalDiff = 0;
    for (let i = 0; i < 21; i++) {
      const p1 = currentFeature[i];
      const p2 = template[i];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y, (p1.z - p2.z) * 0.5);
      totalDiff += dist;
    }

    const avgDiff = totalDiff / 21;
    // 映射到相似度评分：avgDiff 0 -> 100%, avgDiff 0.8 -> 0%
    const similarity = Math.max(0, 1 - avgDiff / 0.7);
    return similarity;
  }

  /**
   * 实时匹配检测已录制的手势，若匹配且不在冷却期则触发绑定事件
   * @param {Array<{x: number, y: number, z: number}>} rawLandmarks
   * @param {Function} onTrigger 动作触发回调 (gesture)
   * @returns {{ matched: Object|null, similarity: number }}
   */
  match(rawLandmarks, onTrigger) {
    if (this.isRecording) {
      this.feedFrame(rawLandmarks);
      return { matched: null, similarity: 0 };
    }

    if (!rawLandmarks || this.gestures.length === 0) {
      return { matched: null, similarity: 0 };
    }

    const currentFeature = this.extractFeatureVector(rawLandmarks);
    if (!currentFeature) return { matched: null, similarity: 0 };

    let bestMatch = null;
    let highestScore = 0;

    for (const gesture of this.gestures) {
      const score = this.computeSimilarity(currentFeature, gesture.template);
      if (score > highestScore) {
        highestScore = score;
        bestMatch = gesture;
      }
    }

    if (highestScore >= this.matchThreshold && bestMatch) {
      const now = performance.now();
      const lastTime = this.lastTriggerTimes.get(bestMatch.id) || 0;

      if (now - lastTime >= this.triggerCooldown) {
        this.lastTriggerTimes.set(bestMatch.id, now);
        if (onTrigger) {
          onTrigger(bestMatch);
        }
      }

      return { matched: bestMatch, similarity: highestScore };
    }

    return { matched: null, similarity: highestScore };
  }

  /**
   * 本地持久化储存
   */
  saveGestures() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.gestures));
    } catch (e) {
      console.warn('手势保存至 LocalStorage 失败:', e);
    }
  }

  loadGestures() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  deleteGesture(id) {
    this.gestures = this.gestures.filter((g) => g.id !== id);
    this.saveGestures();
  }
}
