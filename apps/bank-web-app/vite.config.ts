/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const webAppPort = Number.parseInt(process.env.WEB_APP_PORT || '4200', 10);
const webAppPreviewPort = Number.parseInt(
  process.env.WEB_APP_PREVIEW_PORT || String(webAppPort + 100),
  10
);

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/demo-bank-app',
  server: {
    port: webAppPort,
    host: 'localhost',
    watch: {
      usePolling: true,
    },
  },
  preview: {
    port: webAppPreviewPort,
    host: 'localhost',
  },
  plugins: [react()],
  define: {
    // Transform BANK_API_URL environment variable to a global constant
    __BANK_API_URL__: JSON.stringify(
      process.env.BANK_API_URL || 'http://localhost:3000'
    ),
    __INTRO_VIDEO_URL__: JSON.stringify(
      process.env.INTRO_VIDEO_URL || '/assets/login-demo-placeholder.mp4'
    ),
    __PAYNOTE_DEMO_VIDEO_URL__: JSON.stringify(
      process.env.PAYNOTE_DEMO_VIDEO_URL || '/assets/login-demo-placeholder.mp4'
    ),
    __UI_REFRESH_DISABLE_POLLING__: JSON.stringify(
      process.env.UI_REFRESH_DISABLE_POLLING || 'false'
    ),
  },
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    watch: false,
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
    isolate: true,
    passWithNoTests: true,
  },
}));
