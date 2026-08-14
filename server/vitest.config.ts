import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(dirname, '../shared'),
    },
  },
  test: {
    // shared/는 서버·클라이언트가 같이 쓰는 단일 소스라 여기서 함께 돌린다
    include: ['src/**/*.test.ts', '../shared/**/*.test.ts'],
  },
});
