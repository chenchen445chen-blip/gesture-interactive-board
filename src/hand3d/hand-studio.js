import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Tween, Group as TweenGroup, Easing } from '@tweenjs/tween.js';
import { animate, stagger } from 'animejs';
import { ProceduralHandTextures } from './tsl-textures.js';
import { SuperColliderSynth } from './supercollider-synth.js';
import { HandPhysicsEngine } from './ammo-physics.js';
import {
  HAND_POSE_PRESETS,
  computeAnatomicalHandPoints,
  evaluateRemotionFramePose,
} from './hand-pose-presets.js';

/**
 * Hand3DStudio — 基于截图中 8 大 AI 创意工具构建的「3D 手模静态展示与开发实验室」
 *
 * 第一步开发模式：
 * - 不需要开启摄像头或接入 MediaPipe 手势识别，启动即在视口中央静态呈现超精细 3D 手模
 * - 支持鼠标 360° 轨道旋转 (OrbitControls)、缩放、平移审视每一处指节、掌弓、指甲盖与肌理
 * - 完整融合截图中 8 大工具能力：
 *   01. Three.js      — 实时三维解剖学手模网格与 PBR 次表面光影
 *   02. Anime.js      — 二维 UI 面板、工具卡片、声波频谱与仪表过渡动画
 *   03. Tween.js      — 6 大预设手势姿态与手指弯曲度平滑缓动过渡
 *   04. Ammo.js       — 21 关节运动学碰撞体积包络 & 动态物理小球碰撞测试
 *   05. TSL Textures  — 程序化皮肤微毛孔、掌纹凹凸贴图 & 赛博蜂窝网格纹理
 *   06. SuperCollider — 实时 Web Audio 节点合成器（姿态和弦、关节伺服音、物理碰撞音）
 *   07. Remotion      — 0~120 帧代码驱动时间轴关键帧步进器 (Frame Scrubber)
 *   08. FFmpeg        — 3D 手模画布实时视频流捕获与一键导出 WebM/MP4 验收视频
 */
export class Hand3DStudio {
  constructor(hand3dScene, options = {}) {
    this.hand3dScene = hand3dScene;
    this.options = options;

    this.active = true;
    this.rafId = null;

    // 独立 3D 透视相机与轨道控制器（静态开发模式专属，提供真实 3D 纵深与 360° 自由旋转审视）
    this.studioCamera = null;
    this.orbitControls = null;
    this.studioStageGroup = null;
    this.gridHelper = null;
    this.pedestalRing = null;

    // 03. Tween.js 动画组与当前手部关节状态
    this.tweenGroup = new TweenGroup();
    this.currentPresetId = 'open';
    this.poseState = {
      thumb: 0.08,
      index: 0.06,
      middle: 0.05,
      ring: 0.07,
      pinky: 0.09,
      spread: 0.35,
      thumbOpposition: 0.15,
      wristRotY: 0.16,
      wristRotX: -0.1,
      autoTurntable: false,
      showBothHands: true,
    };

    // 05. TSL Textures 程序纹理状态
    this.tslTextures = null;
    this.tslEnabled = true;

    // 06. SuperCollider 声音合成器
    this.synth = new SuperColliderSynth();

    // 04. Ammo.js 物理模拟引擎
    this.physics = null;

    // 07. Remotion 帧序列时间轴状态
    this.remotionState = {
      playing: false,
      frame: 0,
      totalFrames: 120,
      fps: 30,
      lastFrameTime: 0,
    };

    // 08. FFmpeg 录制导出状态
    this.recorder = null;
    this.recordedChunks = [];
    this.isRecording = false;

    this._initStudio3DEnvironment();
    this._applyTSLProceduralTextures(true);
    this._buildStudioUI();
    this.enterStudioMode();
  }

  // ═══════════════════════════════════════════════════════
  //  01. Three.js — 初始化 3D 透视相机、轨道控制器与全息展台
  // ═══════════════════════════════════════════════════════

  _initStudio3DEnvironment() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.studioCamera = new THREE.PerspectiveCamera(38, w / h, 1, 5000);
    this.studioCamera.position.set(0, 42, 680);
    this.studioCamera.lookAt(0, 15, 0);

    // OrbitControls 绑定在 3D Canvas 上（开发模式下开启 pointer-events: auto）
    this.orbitControls = new OrbitControls(this.studioCamera, this.hand3dScene.canvas);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.06;
    this.orbitControls.target.set(0, 15, 0);
    this.orbitControls.minDistance = 240;
    this.orbitControls.maxDistance = 1200;

    // 3D 实验室全息舞台底座网格
    this.studioStageGroup = new THREE.Group();

    // 极客风圆形全息刻度环
    const ringGeo1 = new THREE.RingGeometry(158, 162, 64);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0x6366f1,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    this.pedestalRing = new THREE.Mesh(ringGeo1, ringMat1);
    this.pedestalRing.rotation.x = -Math.PI / 2;
    this.pedestalRing.position.y = -195;
    this.studioStageGroup.add(this.pedestalRing);

    const ringGeo2 = new THREE.RingGeometry(215, 217, 64);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
    });
    const outerRing = new THREE.Mesh(ringGeo2, ringMat2);
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = -195;
    this.studioStageGroup.add(outerRing);

    // 底部三维坐标参考网格
    this.gridHelper = new THREE.GridHelper(520, 20, 0x4f46e5, 0x1e293b);
    this.gridHelper.position.y = -196;
    this.gridHelper.material.transparent = true;
    this.gridHelper.material.opacity = 0.35;
    this.studioStageGroup.add(this.gridHelper);

    this.hand3dScene.scene.add(this.studioStageGroup);

    // 04. Ammo.js 物理引擎初始化
    this.physics = new HandPhysicsEngine(this.hand3dScene.scene, (impactVel) => {
      this.synth.triggerPhysicsImpact(impactVel);
      this._pulseToolCard('ammo');
    });
  }

  // ═══════════════════════════════════════════════════════
  //  05. TSL Textures — 注入程序化微毛孔与掌纹凹凸贴图
  // ═══════════════════════════════════════════════════════

  _applyTSLProceduralTextures(enabled) {
    this.tslEnabled = enabled;
    if (!this.tslTextures) {
      this.tslTextures = {
        skin: ProceduralHandTextures.createSkinTextures(),
        cyber: ProceduralHandTextures.createCyberTextures(),
      };
    }

    const skinMats = this.hand3dScene.materials.skin;
    const cyberMats = this.hand3dScene.materials.cyber;

    if (enabled) {
      ['palm', 'finger', 'joint', 'wrist'].forEach((k) => {
        if (skinMats[k]) {
          skinMats[k].color.setHex(k === 'palm' ? 0xffffff : 0xefbe9b);
          skinMats[k].map = this.tslTextures.skin.map;
          skinMats[k].bumpMap = this.tslTextures.skin.bumpMap;
          skinMats[k].roughnessMap = this.tslTextures.skin.roughnessMap;
          skinMats[k].bumpScale = 0.28;
          skinMats[k].needsUpdate = true;
        }
        if (cyberMats[k]) {
          cyberMats[k].bumpMap = this.tslTextures.cyber;
          cyberMats[k].bumpScale = 0.65;
          cyberMats[k].needsUpdate = true;
        }
      });
    } else {
      ['palm', 'finger', 'joint', 'wrist'].forEach((k) => {
        if (skinMats[k]) {
          skinMats[k].color.setHex(0xf4c29f);
          skinMats[k].map = null;
          skinMats[k].bumpMap = null;
          skinMats[k].roughnessMap = null;
          skinMats[k].needsUpdate = true;
        }
        if (cyberMats[k]) {
          cyberMats[k].bumpMap = null;
          cyberMats[k].needsUpdate = true;
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════
  //  03. Tween.js — 丝滑切换 3D 手势姿态
  // ═══════════════════════════════════════════════════════

  transitionToPreset(presetId, duration = 520) {
    const preset = HAND_POSE_PRESETS[presetId];
    if (!preset) return;

    this.currentPresetId = presetId;
    this.remotionState.playing = false;
    this._updatePlayBtnUI();

    const target = {
      thumb: preset.curls.thumb,
      index: preset.curls.index,
      middle: preset.curls.middle,
      ring: preset.curls.ring,
      pinky: preset.curls.pinky,
      spread: preset.spread,
      thumbOpposition: preset.thumbOpposition,
    };

    new Tween(this.poseState, this.tweenGroup)
      .to(target, duration)
      .easing(Easing.Cubic.Out)
      .onUpdate(() => {
        this._syncSlidersFromState();
      })
      .start();

    // 触发 06 SuperCollider 合成音效与 02 Anime.js 卡片动效
    const presetKeys = Object.keys(HAND_POSE_PRESETS);
    this.synth.triggerPoseSound(presetKeys.indexOf(presetId));
    this._pulseToolCard('tween');
    this._highlightPresetBtn(presetId);
  }

  // ═══════════════════════════════════════════════════════
  //  计算当前帧 3D 手模 21 关节坐标并驱动渲染
  // ═══════════════════════════════════════════════════════

  _computeCurrentWorldPoints() {
    const localPts = computeAnatomicalHandPoints({
      curls: {
        thumb: this.poseState.thumb,
        index: this.poseState.index,
        middle: this.poseState.middle,
        ring: this.poseState.ring,
        pinky: this.poseState.pinky,
      },
      spread: this.poseState.spread,
      thumbOpposition: this.poseState.thumbOpposition,
    });

    // 应用手腕整体旋转与缩放（适配视口中央 3D 展示尺寸）
    const euler = new THREE.Euler(this.poseState.wristRotX, this.poseState.wristRotY, 0, 'YXZ');
    const scale = 1.45;

    return localPts.map((pt) => {
      const v = pt.clone().multiplyScalar(scale).applyEuler(euler);
      return { x: v.x, y: v.y, z: v.z };
    });
  }

  // ═══════════════════════════════════════════════════════
  //  进入 / 退出 静态 3D 手模开发实验室模式
  // ═══════════════════════════════════════════════════════

  enterStudioMode() {
    this.active = true;
    this.studioStageGroup.visible = true;
    this.hand3dScene.canvas.style.pointerEvents = 'auto';
    this.hand3dScene.canvas.style.cursor = 'grab';
    this.orbitControls.enabled = true;

    if (this.studioPanelEl) {
      this.studioPanelEl.classList.remove('hidden');
      // 02. Anime.js 入场级联动画
      animate('.toolkit-card-item', {
        opacity: [0, 1],
        translateY: [14, 0],
        delay: stagger(45),
        duration: 480,
        ease: 'outCubic',
      });
    }

    const toggleBtn = document.getElementById('btn-toggle-studio');
    if (toggleBtn) toggleBtn.classList.add('active');

    if (!this.rafId) {
      this._lastTime = performance.now();
      this._studioLoop();
    }
  }

  exitStudioMode() {
    this.active = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.studioStageGroup.visible = false;
    this.physics.setEnabled(false);
    this.physics.setShowColliders(false);
    this.hand3dScene.canvas.style.pointerEvents = 'none';
    this.orbitControls.enabled = false;

    if (this.studioPanelEl) {
      this.studioPanelEl.classList.add('hidden');
    }

    const toggleBtn = document.getElementById('btn-toggle-studio');
    if (toggleBtn) toggleBtn.classList.remove('active');

    // 清空静态手模，交还给原有的画板/摄像头手势模式
    this.hand3dScene.update([], false);
  }

  toggleStudioMode() {
    if (this.active) {
      this.exitStudioMode();
    } else {
      this.enterStudioMode();
    }
    return this.active;
  }

  _studioLoop() {
    if (!this.active) return;

    const now = performance.now();
    const dt = Math.min(0.05, (now - (this._lastTime || now)) / 1000);
    this._lastTime = now;

    // 03. Tween.js 更新
    this.tweenGroup.update(now);

    // 07. Remotion 帧序列自动播放步进（采用 60FPS 连续浮点帧时间增量，消除离散跳帧抖动）
    if (this.remotionState.playing) {
      this.remotionState.frame += dt * this.remotionState.fps;
      if (this.remotionState.frame > this.remotionState.totalFrames) {
        this.remotionState.frame -= this.remotionState.totalFrames;
      }
      this._applyRemotionFrame(this.remotionState.frame);
    }

    // 自动旋转展台
    if (this.poseState.autoTurntable) {
      this.poseState.wristRotY += dt * 0.85;
    }

    if (this.pedestalRing) {
      this.pedestalRing.rotation.z += dt * 0.25;
    }

    // 01. Three.js 驱动真实一体式蒙皮 3D 人手高模 (左右双手同步镜像展示 / 单手切换)
    let pts3D = null;
    const rightHand = this.hand3dScene.hands.Right;
    const leftHand = this.hand3dScene.hands.Left;
    const isDual = this.poseState.showBothHands;

    if (rightHand) {
      rightHand.group.visible = true;
      if (
        rightHand.gltfModel &&
        this.hand3dScene.modelLoadState.Right === 'loaded' &&
        this.hand3dScene.skinnedDriver
      ) {
        rightHand.gltfWrapper.visible = true;
        this.hand3dScene._setAnatomicalVisible(rightHand, false);
        if (rightHand.shadowMesh) rightHand.shadowMesh.visible = false;
        if (rightHand.pinchHaloMesh) rightHand.pinchHaloMesh.visible = false;
        if (rightHand.eraserMesh) rightHand.eraserMesh.visible = false;
        pts3D = this.hand3dScene.skinnedDriver.applyPoseToSkinnedHand(
          rightHand.gltfModel,
          this.poseState,
          isDual ? 1950 : 2350,
          { x: isDual ? 145 : 0, y: 12, z: 0 }
        );
      } else {
        pts3D = this._computeCurrentWorldPoints();
        rightHand.gltfWrapper.visible = false;
        this.hand3dScene._setAnatomicalVisible(rightHand, true);
        this.hand3dScene._driveAnatomicalHand(rightHand, pts3D, null);
        if (rightHand.shadowMesh) rightHand.shadowMesh.visible = false;
      }
    }

    if (leftHand) {
      leftHand.group.visible = isDual;
      if (
        isDual &&
        leftHand.gltfModel &&
        this.hand3dScene.modelLoadState.Left === 'loaded' &&
        this.hand3dScene.skinnedDriver
      ) {
        leftHand.gltfWrapper.visible = true;
        this.hand3dScene._setAnatomicalVisible(leftHand, false);
        if (leftHand.shadowMesh) leftHand.shadowMesh.visible = false;
        if (leftHand.pinchHaloMesh) leftHand.pinchHaloMesh.visible = false;
        if (leftHand.eraserMesh) leftHand.eraserMesh.visible = false;
        this.hand3dScene.skinnedDriver.applyPoseToSkinnedHand(
          leftHand.gltfModel,
          this.poseState,
          1950,
          { x: -145, y: 12, z: 0 }
        );
      }
    }

    // 04. Ammo.js 物理刚体碰撞步进
    if (pts3D) {
      this.physics.step(pts3D, dt);
    }

    // 更新轨道控制器并使用 3D 透视相机渲染
    this.orbitControls.update();
    this.hand3dScene.renderer.render(this.hand3dScene.scene, this.studioCamera);

    this.rafId = requestAnimationFrame(() => this._studioLoop());
  }

  // ═══════════════════════════════════════════════════════
  //  07. Remotion — 帧级时间轴姿态解算
  // ═══════════════════════════════════════════════════════

  _applyRemotionFrame(frame) {
    this.remotionState.frame = frame;
    const evaluated = evaluateRemotionFramePose(frame, this.remotionState.totalFrames);

    Object.assign(this.poseState, {
      thumb: evaluated.curls.thumb,
      index: evaluated.curls.index,
      middle: evaluated.curls.middle,
      ring: evaluated.curls.ring,
      pinky: evaluated.curls.pinky,
      spread: evaluated.spread,
      thumbOpposition: evaluated.thumbOpposition,
    });

    this._syncSlidersFromState();

    const scrubber = document.getElementById('remotion-frame-scrubber');
    const label = document.getElementById('remotion-frame-label');
    const stageLabel = document.getElementById('remotion-stage-label');
    const intFrame = Math.round(frame);
    if (scrubber) scrubber.value = String(intFrame);
    if (label) label.textContent = `FRAME ${String(intFrame).padStart(3, '0')} / ${this.remotionState.totalFrames}`;
    if (stageLabel) stageLabel.textContent = evaluated.activeLabel;
  }

  // ═══════════════════════════════════════════════════════
  //  08. FFmpeg — 实时录制 3D 手模 WebGL 画面并导出视频
  // ═══════════════════════════════════════════════════════

  toggleVideoRecording() {
    if (this.isRecording) {
      this._stopRecording();
    } else {
      this._startRecording();
    }
  }

  _startRecording() {
    const canvas = this.hand3dScene.canvas;
    if (!canvas.captureStream) {
      if (this.options.onToast) this.options.onToast('当前浏览器不支持 Canvas 视频流捕获');
      return;
    }

    const stream = canvas.captureStream(60);
    const mimeTypes = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    const mimeType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) || '';

    this.recordedChunks = [];
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };

    this.recorder.onstop = () => {
      const blob = new Blob(this.recordedChunks, { type: mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hand3d-vibecoding-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      if (this.options.onToast) {
        this.options.onToast('🎬 08 FFmpeg 视频流封装完成，已下载 3D 手模展示视频');
      }
    };

    this.recorder.start();
    this.isRecording = true;
    this._pulseToolCard('ffmpeg');

    const btn = document.getElementById('btn-ffmpeg-record');
    if (btn) {
      btn.classList.add('recording');
      btn.innerHTML = '<span>⏹️ 停止并导出视频 (录制中...)</span>';
    }
    if (this.options.onToast) {
      this.options.onToast('🔴 08 FFmpeg 已开始捕获 60FPS 3D 手模画面，再次点击即可导出');
    }
  }

  _stopRecording() {
    if (this.recorder && this.isRecording) {
      this.recorder.stop();
    }
    this.isRecording = false;
    const btn = document.getElementById('btn-ffmpeg-record');
    if (btn) {
      btn.classList.remove('recording');
      btn.innerHTML = '<span>🎬 08 FFmpeg 录制导出视频</span>';
    }
  }

  // ═══════════════════════════════════════════════════════
  //  02. Anime.js — 构建 8 大工具卡片与交互实验室 UI 面板
  // ═══════════════════════════════════════════════════════

  _buildStudioUI() {
    const container = document.createElement('div');
    container.id = 'hand3d-studio-overlay';
    container.className = 'hand3d-studio-overlay';

    container.innerHTML = `
      <!-- 左侧：截图中 8 大 AI Vibecoding 工具矩阵卡片 -->
      <aside class="studio-left-dock">
        <div class="studio-dock-header">
          <div class="studio-badge-row">
            <span class="studio-step-badge">STEP 01 · 静态开发模式</span>
            <span class="studio-live-dot">3D 独立预览中</span>
          </div>
          <h2 class="studio-dock-title">AI Vibecoding 8 大工具 · 3D 手模实验室</h2>
          <p class="studio-dock-subtitle">无需开启摄像头 · 鼠标左键拖动 360° 旋转 · 滚轮缩放验收</p>
        </div>

        <div class="toolkit-cards-grid">
          <div class="toolkit-card-item active" data-tool-card="three" title="点击切换 3D 渲染材质风格">
            <div class="tk-num">01<span>AI TOOLKIT</span></div>
            <div class="tk-icon">△</div>
            <div class="tk-name">Three.js</div>
            <div class="tk-desc">实时三维解剖手模</div>
            <div class="tk-status" id="tk-status-three">PBR 皮肤</div>
          </div>

          <div class="toolkit-card-item active" data-tool-card="anime" title="点击触发 Anime.js 弹性 UI 脉冲">
            <div class="tk-num">02<span>AI TOOLKIT</span></div>
            <div class="tk-icon">|||||</div>
            <div class="tk-name">Anime.js</div>
            <div class="tk-desc">二维面板弹簧动效</div>
            <div class="tk-status">v4 引擎已就绪</div>
          </div>

          <div class="toolkit-card-item active" data-tool-card="tween" title="点击随机平滑过渡到下一个手势">
            <div class="tk-num">03<span>AI TOOLKIT</span></div>
            <div class="tk-icon">∿</div>
            <div class="tk-name">Tween.js</div>
            <div class="tk-desc">骨骼动作平滑过渡</div>
            <div class="tk-status">Cubic.Out</div>
          </div>

          <div class="toolkit-card-item" data-tool-card="ammo" title="点击开启/关闭 Ammo.js 物理刚体小球碰撞测试">
            <div class="tk-num">04<span>AI TOOLKIT</span></div>
            <div class="tk-icon">⚄</div>
            <div class="tk-name">Ammo.js</div>
            <div class="tk-desc">刚体碰撞物理模拟</div>
            <div class="tk-status" id="tk-status-ammo">点击开启测试</div>
          </div>

          <div class="toolkit-card-item active" data-tool-card="tsl" title="点击开关 TSL 程序化微毛孔与掌纹凹凸贴图">
            <div class="tk-num">05<span>AI TOOLKIT</span></div>
            <div class="tk-icon">◎</div>
            <div class="tk-name">TSL Textures</div>
            <div class="tk-desc">程序化皮肤/掌纹纹理</div>
            <div class="tk-status" id="tk-status-tsl">纹理已启用</div>
          </div>

          <div class="toolkit-card-item active" data-tool-card="sc" title="点击开关 SuperCollider 实时声音合成反馈">
            <div class="tk-num">06<span>AI TOOLKIT</span></div>
            <div class="tk-icon">∿̸</div>
            <div class="tk-name">SuperCollider</div>
            <div class="tk-desc">程序化声音合成器</div>
            <div class="tk-status" id="tk-status-sc">Synth 开启</div>
          </div>

          <div class="toolkit-card-item active" data-tool-card="remotion" title="点击自动播放/暂停 Remotion 120 帧动作序列">
            <div class="tk-num">07<span>AI TOOLKIT</span></div>
            <div class="tk-icon">▷</div>
            <div class="tk-name">Remotion</div>
            <div class="tk-desc">代码帧序列时间轴</div>
            <div class="tk-status" id="tk-status-remotion">120 帧序列</div>
          </div>

          <div class="toolkit-card-item" data-tool-card="ffmpeg" title="点击录制当前 3D 手模视频并导出">
            <div class="tk-num">08<span>AI TOOLKIT</span></div>
            <div class="tk-icon">»</div>
            <div class="tk-name">FFmpeg</div>
            <div class="tk-desc">60FPS 视频流导出</div>
            <div class="tk-status" id="tk-status-ffmpeg">点击录制</div>
          </div>
        </div>

        <!-- 3D 材质与辅助视图开关 -->
        <div class="studio-quick-toggles">
          <button class="studio-chip active" id="btn-studio-skin">🖐️ PBR 拟真皮肤</button>
          <button class="studio-chip" id="btn-studio-cyber">⚡ 赛博钛金机甲</button>
          <button class="studio-chip active" id="btn-studio-dual-hands">🤲 左右双手同屏</button>
          <button class="studio-chip" id="btn-studio-turntable">🔄 自动旋转展台</button>
        </div>
      </aside>

      <!-- 右侧：3D 手势预设切换 (Tween.js) + 5 指独立关节控制器 -->
      <aside class="studio-right-inspector">
        <div class="inspector-section">
          <div class="inspector-header">
            <span>03 Tween.js · 静态手势预设库</span>
            <button class="inspector-reset-btn" id="btn-studio-reset-cam" title="复位 3D 视角">视角复位</button>
          </div>
          <div class="pose-presets-grid" id="pose-presets-grid">
            ${Object.values(HAND_POSE_PRESETS)
              .map(
                (p) => `
              <button class="pose-preset-btn ${p.id === 'open' ? 'active' : ''}" data-pose="${p.id}">
                <span class="pose-btn-title">${p.name}</span>
                <span class="pose-btn-desc">${p.desc}</span>
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="inspector-section">
          <div class="inspector-header">
            <span>01 Three.js · 五指正向运动学关节调试</span>
            <span class="inspector-sub">0% 伸展 → 100% 握拢</span>
          </div>

          <div class="finger-sliders-list">
            <div class="finger-slider-row">
              <label>👍 拇指弯曲 (Thumb)</label>
              <input type="range" min="0" max="1" step="0.01" value="${this.poseState.thumb}" data-finger="thumb" />
              <span class="finger-val" id="val-thumb">8%</span>
            </div>
            <div class="finger-slider-row">
              <label>☝️ 食指弯曲 (Index)</label>
              <input type="range" min="0" max="1" step="0.01" value="${this.poseState.index}" data-finger="index" />
              <span class="finger-val" id="val-index">6%</span>
            </div>
            <div class="finger-slider-row">
              <label>🖕 中指弯曲 (Middle)</label>
              <input type="range" min="0" max="1" step="0.01" value="${this.poseState.middle}" data-finger="middle" />
              <span class="finger-val" id="val-middle">5%</span>
            </div>
            <div class="finger-slider-row">
              <label>💍 无名指弯曲 (Ring)</label>
              <input type="range" min="0" max="1" step="0.01" value="${this.poseState.ring}" data-finger="ring" />
              <span class="finger-val" id="val-ring">7%</span>
            </div>
            <div class="finger-slider-row">
              <label>🤙 小指弯曲 (Pinky)</label>
              <input type="range" min="0" max="1" step="0.01" value="${this.poseState.pinky}" data-finger="pinky" />
              <span class="finger-val" id="val-pinky">9%</span>
            </div>
            <div class="finger-slider-row">
              <label>🖖 五指张开度 (Spread)</label>
              <input type="range" min="-0.2" max="0.9" step="0.01" value="${this.poseState.spread}" data-finger="spread" />
              <span class="finger-val" id="val-spread">35%</span>
            </div>
            <div class="finger-slider-row">
              <label>🤏 拇指对掌度 (Opposition)</label>
              <input type="range" min="0" max="1" step="0.01" value="${this.poseState.thumbOpposition}" data-finger="thumbOpposition" />
              <span class="finger-val" id="val-thumbOpposition">15%</span>
            </div>
          </div>
        </div>

        <div class="inspector-footer-actions">
          <button class="studio-action-btn primary" id="btn-ffmpeg-record">
            <span>🎬 08 FFmpeg 录制导出视频</span>
          </button>
          <button class="studio-action-btn secondary" id="btn-exit-studio-to-board">
            <span>🎨 隐藏实验室 · 返回画板</span>
          </button>
        </div>
      </aside>

      <!-- 底部：07 Remotion 代码帧序列时间轴 (Frame 000 ~ 120) -->
      <footer class="studio-bottom-timeline">
        <button class="remotion-play-btn" id="btn-remotion-play" title="播放/暂停 120 帧手势关键帧序列">
          ▶ 播放帧序列
        </button>
        <div class="remotion-track-wrapper">
          <div class="remotion-track-meta">
            <span class="remotion-tag">07 Remotion · 代码帧序列驱动</span>
            <span class="remotion-stage" id="remotion-stage-label">自然张开 → 捏合下笔</span>
            <span class="remotion-frame-num" id="remotion-frame-label">FRAME 000 / 120</span>
          </div>
          <input
            type="range"
            id="remotion-frame-scrubber"
            min="0"
            max="120"
            step="1"
            value="0"
          />
        </div>
      </footer>
    `;

    document.getElementById('app')?.appendChild(container);
    this.studioPanelEl = container;

    this._bindStudioEvents();
  }

  _bindStudioEvents() {
    // 1. 预设姿态按钮 (03 Tween.js)
    const presetBtns = this.studioPanelEl.querySelectorAll('.pose-preset-btn');
    presetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const poseId = btn.dataset.pose;
        this.transitionToPreset(poseId);
      });
    });

    // 2. 五指独立滑块
    const sliders = this.studioPanelEl.querySelectorAll('input[data-finger]');
    sliders.forEach((input) => {
      input.addEventListener('input', (e) => {
        const key = input.dataset.finger;
        const val = parseFloat(e.target.value);
        this.poseState[key] = val;
        this.remotionState.playing = false;
        this._updatePlayBtnUI();
        this._syncSlidersFromState();
        this.synth.triggerJointGrain(Math.abs(val));
      });
    });

    // 3. 8 大工具卡片点击交互
    this.studioPanelEl.querySelectorAll('.toolkit-card-item').forEach((card) => {
      card.addEventListener('click', () => {
        const tool = card.dataset.toolCard;
        this._handleToolkitCardClick(tool, card);
      });
    });

    // 4. 快捷开关按钮
    const btnSkin = document.getElementById('btn-studio-skin');
    const btnCyber = document.getElementById('btn-studio-cyber');
    const btnDualHands = document.getElementById('btn-studio-dual-hands');
    const btnTurntable = document.getElementById('btn-studio-turntable');

    btnSkin?.addEventListener('click', () => {
      this.hand3dScene.setTheme('skin');
      btnSkin.classList.add('active');
      btnCyber?.classList.remove('active');
      const status = document.getElementById('tk-status-three');
      if (status) status.textContent = 'PBR 皮肤';
      this._pulseToolCard('three');
    });

    btnCyber?.addEventListener('click', () => {
      this.hand3dScene.setTheme('cyber');
      btnCyber.classList.add('active');
      btnSkin?.classList.remove('active');
      const status = document.getElementById('tk-status-three');
      if (status) status.textContent = '赛博机甲';
      this._pulseToolCard('three');
    });

    btnDualHands?.addEventListener('click', () => {
      this.poseState.showBothHands = !this.poseState.showBothHands;
      btnDualHands.classList.toggle('active', this.poseState.showBothHands);
      btnDualHands.textContent = this.poseState.showBothHands ? '🤲 左右双手同屏' : '🤚 单手特写模式';
    });

    btnTurntable?.addEventListener('click', () => {
      this.poseState.autoTurntable = !this.poseState.autoTurntable;
      btnTurntable.classList.toggle('active', this.poseState.autoTurntable);
    });

    // 5. 复位 3D 相机视角
    document.getElementById('btn-studio-reset-cam')?.addEventListener('click', () => {
      this.poseState.wristRotY = 0.16;
      this.poseState.wristRotX = -0.1;
      this.studioCamera.position.set(0, 42, 680);
      this.orbitControls.target.set(0, 15, 0);
      this.orbitControls.update();
    });

    // 6. 07 Remotion 时间轴播放与拖动
    const playBtn = document.getElementById('btn-remotion-play');
    const scrubber = document.getElementById('remotion-frame-scrubber');

    playBtn?.addEventListener('click', () => {
      this.remotionState.playing = !this.remotionState.playing;
      this.remotionState.lastFrameTime = performance.now();
      this._updatePlayBtnUI();
      this._pulseToolCard('remotion');
    });

    scrubber?.addEventListener('input', (e) => {
      this.remotionState.playing = false;
      this._updatePlayBtnUI();
      const frame = parseInt(e.target.value, 10) || 0;
      this._applyRemotionFrame(frame);
    });

    // 7. 08 FFmpeg 视频录制导出
    document.getElementById('btn-ffmpeg-record')?.addEventListener('click', () => {
      this.toggleVideoRecording();
    });

    // 8. 返回画板 / 顶部工具栏切换按钮
    document.getElementById('btn-exit-studio-to-board')?.addEventListener('click', () => {
      this.exitStudioMode();
    });

    document.getElementById('btn-toggle-studio')?.addEventListener('click', () => {
      this.toggleStudioMode();
    });
  }

  _handleToolkitCardClick(tool, card) {
    this._pulseToolCard(tool);

    switch (tool) {
      case 'three': {
        const nextTheme = this.hand3dScene.currentTheme === 'skin' ? 'cyber' : 'skin';
        this.hand3dScene.setTheme(nextTheme);
        document.getElementById('btn-studio-skin')?.classList.toggle('active', nextTheme === 'skin');
        document.getElementById('btn-studio-cyber')?.classList.toggle('active', nextTheme === 'cyber');
        const status = document.getElementById('tk-status-three');
        if (status) status.textContent = nextTheme === 'skin' ? 'PBR 皮肤' : '赛博机甲';
        break;
      }
      case 'anime': {
        animate('.toolkit-card-item', {
          scale: [1, 0.94, 1.03, 1],
          delay: stagger(35, { from: 'center' }),
          duration: 520,
          ease: 'outElastic(1, .6)',
        });
        this.synth.triggerPoseSound(2);
        break;
      }
      case 'tween': {
        const keys = Object.keys(HAND_POSE_PRESETS);
        const nextIdx = (keys.indexOf(this.currentPresetId) + 1) % keys.length;
        this.transitionToPreset(keys[nextIdx]);
        break;
      }
      case 'ammo': {
        const next = !this.physics.enabled;
        this.physics.setEnabled(next);
        this.physics.setShowColliders(next);
        card.classList.toggle('active', next);
        document.getElementById('btn-studio-colliders')?.classList.toggle('active', next);
        const status = document.getElementById('tk-status-ammo');
        if (status) status.textContent = next ? '物理碰撞运行中' : '点击开启测试';
        if (next && this.options.onToast) {
          this.options.onToast('⚄ 04 Ammo.js 刚体碰撞已启动：彩色小球将与 3D 手模 21 个关节发生真实弹性碰撞');
        }
        break;
      }
      case 'tsl': {
        const next = !this.tslEnabled;
        this._applyTSLProceduralTextures(next);
        card.classList.toggle('active', next);
        const status = document.getElementById('tk-status-tsl');
        if (status) status.textContent = next ? '纹理已启用' : '纯色无纹理';
        break;
      }
      case 'sc': {
        this.synth.enabled = !this.synth.enabled;
        card.classList.toggle('active', this.synth.enabled);
        const status = document.getElementById('tk-status-sc');
        if (status) status.textContent = this.synth.enabled ? 'Synth 开启' : '静音模式';
        if (this.synth.enabled) this.synth.triggerPoseSound(0);
        break;
      }
      case 'remotion': {
        this.remotionState.playing = !this.remotionState.playing;
        this.remotionState.lastFrameTime = performance.now();
        this._updatePlayBtnUI();
        break;
      }
      case 'ffmpeg': {
        this.toggleVideoRecording();
        break;
      }
    }
  }

  _pulseToolCard(toolName) {
    const card = this.studioPanelEl?.querySelector(`.toolkit-card-item[data-tool-card="${toolName}"]`);
    if (!card) return;
    animate(card, {
      scale: [1, 1.06, 1],
      duration: 320,
      ease: 'outQuad',
    });
  }

  _highlightPresetBtn(presetId) {
    this.studioPanelEl?.querySelectorAll('.pose-preset-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.pose === presetId);
    });
  }

  _updatePlayBtnUI() {
    const playBtn = document.getElementById('btn-remotion-play');
    const status = document.getElementById('tk-status-remotion');
    if (playBtn) {
      playBtn.textContent = this.remotionState.playing ? '⏸ 暂停帧序列' : '▶ 播放帧序列';
      playBtn.classList.toggle('playing', this.remotionState.playing);
    }
    if (status) {
      status.textContent = this.remotionState.playing ? '序列播放中' : '120 帧序列';
    }
  }

  _syncSlidersFromState() {
    if (!this.studioPanelEl) return;
    const keys = ['thumb', 'index', 'middle', 'ring', 'pinky', 'spread', 'thumbOpposition'];
    keys.forEach((k) => {
      const val = this.poseState[k];
      const input = this.studioPanelEl.querySelector(`input[data-finger="${k}"]`);
      const label = document.getElementById(`val-${k}`);
      if (input) input.value = String(val);
      if (label) label.textContent = `${Math.round(val * 100)}%`;
    });
  }

  resize(w, h) {
    if (this.studioCamera) {
      this.studioCamera.aspect = w / h;
      this.studioCamera.updateProjectionMatrix();
    }
  }
}
