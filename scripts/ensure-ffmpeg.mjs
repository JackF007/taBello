// FFmpeg comes from ffmpeg-static, which downloads its binary while npm installs it. That download
// can be skipped or lost (an install run with scripts ignored, a dropped connection, an antivirus
// quarantining ffmpeg.exe), and then no file can be transcribed: fetch it again when it is missing.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const binary = require('ffmpeg-static');

if (binary && !existsSync(binary)) {
  console.log(`FFmpeg is missing (${binary}): downloading it again…`);
  const install = require.resolve('ffmpeg-static/install.js');
  const result = spawnSync(process.execPath, [install], { cwd: path.dirname(install), stdio: 'inherit' });
  if (result.status !== 0 || !existsSync(binary)) {
    console.error('Could not download FFmpeg. Check your connection (and your antivirus), then run: npm rebuild ffmpeg-static');
    process.exit(1);
  }
}
