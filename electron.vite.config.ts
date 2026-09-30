import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react-swc';
import { alphaTab } from '@coderline/alphatab-vite';

export default defineConfig({
  main: {},
  preload: {
    build: {
      // Sandboxed preload scripts must be CommonJS.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, 'src/renderer/src'),
      },
    },
    plugins: [
      react(),
      // Copies alphaTab's music font and soundfont into public/assets so they ship offline.
      alphaTab({ assetOutputDir: resolve(import.meta.dirname, 'src/renderer/public/assets') }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            alphatab: ['@coderline/alphatab'],
          },
        },
      },
    },
  },
});
