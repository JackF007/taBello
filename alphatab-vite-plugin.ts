import { Plugin, normalizePath } from 'vite';
import * as path from 'path';
import * as fs from 'fs';

export interface AlphaTabVitePluginOptions {
  alphaTabSourceDir?: string;
  assetOutputDir?: string | false;
  webWorkers?: boolean;
  audioWorklets?: boolean;
}

export function alphaTab(options: AlphaTabVitePluginOptions = {}): Plugin[] {
  // Implementazione semplificata che evita l'uso di BuildEnvironment
  const plugins: Plugin[] = [];
  
  const alphaTabDir = options.alphaTabSourceDir || 
    path.resolve(process.cwd(), 'node_modules/@coderline/alphatab/dist');
  
  const assetDir = options.assetOutputDir === false ? false : 
    (options.assetOutputDir || 'public/assets');
  
  if (assetDir !== false) {
    plugins.push({
      name: 'alphatab-assets',
      apply: 'build',
      closeBundle() {
        const fontSrcDir = path.join(alphaTabDir, 'font');
        const fontDestDir = path.join(assetDir, 'font');
        
        const sfSrcDir = path.join(alphaTabDir, 'soundfont');
        const sfDestDir = path.join(assetDir, 'soundfont');
        
        if (!fs.existsSync(fontDestDir)) {
          fs.mkdirSync(fontDestDir, { recursive: true });
        }
        
        if (!fs.existsSync(sfDestDir)) {
          fs.mkdirSync(sfDestDir, { recursive: true });
        }
        
        // Copia file
        copyFiles(fontSrcDir, fontDestDir);
        copyFiles(sfSrcDir, sfDestDir);
      }
    });
  }
  
  return plugins;
}

function copyFiles(srcDir: string, destDir: string) {
  if (fs.existsSync(srcDir)) {
    const files = fs.readdirSync(srcDir);
    for (const file of files) {
      const srcFile = path.join(srcDir, file);
      const destFile = path.join(destDir, file);
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, destFile);
      }
    }
  }
} 