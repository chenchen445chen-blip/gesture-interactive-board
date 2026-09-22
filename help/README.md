# 手势识别与交互画板 (Gesture Interactive Board)

## 项目简介
本项目运行在现代浏览器中，通过调用前置摄像头并基于 **Google MediaPipe Tasks Vision (Hand Landmark Detection)** 神经网络，实现手部 21 个骨骼关键点的 60fps 实时高精度追踪。支持在无触控、无鼠标状态下，利用单指指引悬浮光标，通过食指与拇指捏合动作进行自然隔空点击与画图。

---

## 目录结构
```text
gesture-interactive-board/
├── index.html              # 应用主结构入口
├── package.json            # 依赖配置与启动脚本 (Vite + MediaPipe)
├── vite.config.js          # 本地开发服务器与跨域配置
├── src/
│   ├── style.css           # 玻璃拟态深色主题与微动效样式
│   ├── main.js             # 应用协调器与 requestAnimationFrame 主循环
│   ├── camera/
│   │   └── camera-manager.js   # 摄像头权限申请、自适应分辨率与水平镜像
│   ├── gesture/
│   │   ├── detector.js         # MediaPipe 视觉模型推理与帧检测
│   │   ├── classifier.js       # 21关键点静态姿态分类（捏合/食指/握拳/手掌）
│   │   ├── motion-detector.js  # 动态手势动作检测（勾手/展开/滑动时序窗口分析）
│   │   └── filter.js           # 坐标低通平滑与自适应防抖滤波
│   ├── cursor/
│   │   └── virtual-cursor.js   # 虚拟光标渲染与原生 DOM 事件分发 (hit-test)
│   ├── canvas/
│   │   └── drawing-board.js    # PS 风格无限/大画布渲染引擎与手部骨骼可视化
│   └── ui/
│       ├── toolbar.js          # 画笔颜色/粗细/交互模式/视图复位控制栏
│       └── stats-hud.js        # 实时 FPS 与手势状态指示器
└── help/                   # 辅助文档目录
    └── README.md           # 本说明文件
```

---

## 交互模式与手势映射规则

### 1. 交互模式区别

| 模式 | 核心手势映射 |
| :--- | :--- |
| **🎨 画笔模式 (Draw)** | 🤏 **捏合**：下笔作画；🖐️ **手掌张开（手心朝前）**：橡皮擦大面积擦除；✊ **握拳**：暂停 |
| **🖼️ 画布控制 (Canvas)** | 🤙 **四指勾入（往前勾手）**：以手所在位置为中心放大画布；🖐️ **四指外展**：缩小画布；🖐️ **掌心移动**：平移画布；👈👉 **挥动手势**：快速向对应方向滑动画布；✊ **握拳**：一键复位视图 (100% 居中) |
| **🖱️ 指针模式 (Select)** | 👉 **食指伸出**：移动光标；🤏 **捏合**：点击 / 选中操作；🖐️ **手掌张开**：释放 / 取消；✊ **握拳**：暂停 |

### 2. 动态动作识别原理 (`MotionDetector`)

通过维护关键点的滑动时序窗口（Window Size = 12 帧），追踪指尖与手腕的相对三维坐标变化速度与幅度：
- **🤙 CURL_IN (四指往前勾)**：检测食指/中指/无名指/小指的 PIP-TIP 相对距离与弯曲变化率，当在窗口内连续快速曲折（从伸展到勾入）时触发画布放大（带 900ms 冷却防止误触连发）。
- **🖐️ CURL_OUT (四指展开)**：四指从弯曲迅速伸张平展，触发画布缩小。
- **👈👉 SWIPE_* (快速挥动)**：手掌在水平或垂直轴向产生高速度位移时触发步进平移。

---

## 运行与开发指南

### 1. 安装依赖
在项目根目录（`/Volumes/out/科研项目/gesture-interactive-board`）执行：
```bash
npm install
```

### 2. 启动本地开发服务
```bash
npm run dev
```
启动后在控制台会输出本地访问链接（默认 `http://localhost:3000`）。在支持 WebRTC 与 WebGL 的现代浏览器（推荐 Chrome 或 Edge）中打开即可。

### 3. 生产打包
```bash
npm run build
```
编译产物将输出至 `dist/` 目录。
