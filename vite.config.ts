import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { alphaTab } from '@coderline/alphatab/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
    alphaTab({
      assetOutputDir: 'public/assets',
      webWorkers: true,
      audioWorklets: true,
      alphaTabSourceDir: path.resolve(__dirname, 'node_modules/@coderline/alphatab/dist')
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          alphatab: ['@coderline/alphatab']
        }
      }
    }
  }
}));
