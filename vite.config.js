import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: false, // 遵循被动执行规约，不主动弹窗打开浏览器
    host: true,
  },
  optimizeDeps: {
    // 确保 MediaPipe WASM 模块能顺利加载
    include: ['@mediapipe/tasks-vision'],
  },
});
