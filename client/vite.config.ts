import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const API_TARGET = 'http://localhost:4310';

/**
 * API 서버가 안 떠 있을 때 프록시가 뱉는 AggregateError 스택 대신,
 * 브라우저에는 원인이 담긴 JSON을, 터미널에는 한 줄 안내를 준다.
 */
let warned = false;
const apiProxy: ProxyOptions = {
  target: API_TARGET,
  configure: (proxy) => {
    proxy.on('error', (err, _req, res) => {
      if (!warned) {
        warned = true;
        console.error(
          `\n❌ API 서버(${API_TARGET})에 연결할 수 없습니다 — \`npm run dev\`의 [api] 로그를 확인하세요.\n` +
            `   (${err.message})\n`,
        );
      }
      const out = res as ServerResponse;
      if ('writeHead' in out && !out.headersSent) {
        out.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        out.end(
          JSON.stringify({
            error: `API 서버(${API_TARGET})에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.`,
            offline: true,
          }),
        );
      } else {
        out.destroy?.();
      }
    });
    proxy.on('proxyRes', () => {
      warned = false;
    });
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(dirname, 'src'),
      '@shared': path.resolve(dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiProxy,
      '/media': { ...apiProxy },
    },
  },
});
