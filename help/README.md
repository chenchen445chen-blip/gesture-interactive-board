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
│   │   ├── classifier.js       # 21关键点几何分类（捏合/食指/握拳/手掌）
│   │   └── filter.js           # 坐标低通平滑与自适应防抖滤波
│   ├── cursor/
│   │   └── virtual-cursor.js   # 虚拟光标渲染与原生 DOM 事件分发 (hit-test)
│   ├── canvas/
│   │   └── drawing-board.js    # Canvas 双层绘图引擎与手部骨骼可视化
│   └── ui/
│       ├── toolbar.js          # 画笔颜色/粗细/橡皮擦/摄像头切换控制栏
│       └── stats-hud.js        # 实时 FPS 与手势状态指示器
└── help/                   # 辅助文档目录
    └── README.md           # 本说明文件
```

---

## 手势映射规则

| 手势动作 | 骨骼特征 | 对应交互 |
| :--- | :--- | :--- |
| **👉 食指伸直指引** | 仅食指伸展，其他手指弯曲 | 移动虚拟光标（Hover 悬停模式） |
| **🤏 拇指与食指捏合** | 拇指尖与食指尖距离小于阈值 | 下笔绘制线条 / 点击选中的 UI 按钮 |
| **🖐️ 手心朝前左右滑动** | 五指伸展，**手心朝向摄像头** | **大面积板擦橡皮擦**（抹除划过的笔迹） |
| **🤚 手背朝前挥动** | 五指伸展，**手背朝向摄像头** | **防误触模式**（仅悬停移动，不触发擦除） |
| **✊ 握拳** | 所有手指均收拢 | 暂停一切绘制 / 恢复指针静止 |

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
