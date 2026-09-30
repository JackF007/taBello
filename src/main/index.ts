import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc';
import { APP_HOST, APP_SCHEME, APP_URL, handleProtocols, registerSchemes } from './protocols';
import { cancelTranscription } from './transcription/service';

const PRELOAD_PATH = path.join(import.meta.dirname, '../preload/index.cjs');
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL;

registerSchemes();

function isTrustedUrl(url: string): boolean {
  if (DEV_SERVER_URL) return url.startsWith(DEV_SERVER_URL);
  // Not `URL.origin`: Node reports "null" as the origin of custom schemes.
  const { protocol, host } = new URL(url);
  return protocol === `${APP_SCHEME}:` && host === APP_HOST;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'TaBello',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  // Links to the outside world open in the user's browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Also blocks the default "navigate to the dropped file" behaviour of drag & drop.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });

  void window.loadURL(DEV_SERVER_URL ?? APP_URL);
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(() => {
    // TaBello never needs camera, microphone, notifications, etc.
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    handleProtocols();
    registerIpcHandlers(isTrustedUrl);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => cancelTranscription());
}
