import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { alphaTab } from '@coderline/alphatab-vite';

const require = createRequire(import.meta.url);

/**
 * Emits the files the transcription worker loads at runtime (WebAssembly binaries and the Basic Pitch
 * model) next to the bundled worker, so node_modules does not have to ship with the app.
 */
function transcriptionAssets(): Plugin {
  const sources = {
    wasm: dirname(require.resolve('@tensorflow/tfjs-backend-wasm')),
    model: join(dirname(require.resolve('@spotify/basic-pitch/package.json')), 'model'),
  };
  return {
    name: 'tabello-transcription-assets',
    generateBundle() {
      for (const [folder, dir] of Object.entries(sources)) {
        for (const file of readdirSync(dir)) {
          if (folder === 'wasm' && !file.endsWith('.wasm')) continue;
          this.emitFile({ type: 'asset', fileName: `transcription-assets/${folder}/${file}`, source: readFileSync(join(dir, file)) });
        }
      }
    },
  };
}

export default defineConfig({
  main: {
    resolve: {
      alias: {
        // Basic Pitch imports the whole TensorFlow.js umbrella; only core + converter are needed.
        '@tensorflow/tfjs': resolve(import.meta.dirname, 'src/main/transcription/tfjs-shim.ts'),
      },
    },
    plugins: [transcriptionAssets()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          // Separate entry: runs in its own utility process (see src/main/transcription/service.ts).
          transcriptionWorker: resolve(import.meta.dirname, 'src/main/transcription/worker.ts'),
        },
        output: {
          // The bundled TensorFlow.js/Emscripten code expects CommonJS globals, which ES modules lack.
          banner: (chunk) =>
            chunk.name === 'transcriptionWorker'
              ? "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" +
                ' const __dirname = import.meta.dirname; const __filename = import.meta.filename;'
              : '',
        },
      },
    },
  },
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
