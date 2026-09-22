/**
 * 摄像头管理器 (CameraManager)
 * 负责获取媒体设备流、处理前置摄像头镜像、分辨率控制与生命周期管理
 */
export class CameraManager {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
    this.isPlaying = false;
  }

  /**
   * 请求开启摄像头权限并绑定视频流
   * @param {Object} options 视频配置选项
   * @returns {Promise<HTMLVideoElement>}
   */
  async startCamera(options = {}) {
    if (this.stream) {
      return this.video;
    }

    const defaultConstraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user', // 前置自拍视角
        frameRate: { ideal: 60, max: 60 },
      },
      audio: false,
    };

    const constraints = {
      ...defaultConstraints,
      video: {
        ...defaultConstraints.video,
        ...options.video,
      },
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;

      return new Promise((resolve) => {
        this.video.onloadedmetadata = () => {
          this.video.play();
          this.isPlaying = true;
          resolve(this.video);
        };
      });
    } catch (err) {
      console.error('无法启动摄像头:', err);
      throw err;
    }
  }

  /**
   * 停止摄像头并释放设备
   */
  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.isPlaying = false;
    this.video.srcObject = null;
  }

  /**
   * 获取视频实际固有尺寸
   */
  getVideoDimensions() {
    return {
      width: this.video.videoWidth || 1280,
      height: this.video.videoHeight || 720,
    };
  }
}
