import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Shorts Factory UI - 로컬 개발 서버 설정
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5200,
    strictPort: true, // 포트 충돌 시 자동 변경 금지 (명시적 오류로 표시)
    open: true, // 서버 시작 시 브라우저 자동 오픈
    // /api 요청을 Express 백엔드(3001)로 프록시
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
