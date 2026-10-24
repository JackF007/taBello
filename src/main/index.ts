import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import { prepareSeparationModel, registerIpcHandlers, startUpdateCheck } from './ipc';
import { log, logError, startLog } from './log';
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

  // Errors in the page go to the log too (rendering the score, playback…).
  window.webContents.on('console-message', ({ level, message, lineNumber }) => {
    if (level === 'error') log('error', `Page: ${message} (line ${lineNumber})`);
  });
  window.webContents.on('render-process-gone', (_event, details) => log('error', `The window's process stopped: ${details.reason}`));

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
    startLog(app.getPath('logs'), `TaBello ${app.getVersion()} on ${process.platform} ${process.arch} (Electron ${process.versions.electron})`);
    // The monitor only watches: Electron still handles the exception as usual.
    process.on('uncaughtExceptionMonitor', (error) => logError('Uncaught exception', error));
    process.on('unhandledRejection', (reason) => logError('Unhandled rejection', reason));
    app.on('child-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit' && details.reason !== 'killed') log('error', `${details.name ?? details.type} stopped: ${details.reason} (exit code ${details.exitCode})`);
    });

    // TaBello never needs camera, microphone, notifications, etc.
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    handleProtocols();
    registerIpcHandlers(isTrustedUrl);
    createWindow();
    prepareSeparationModel();
    startUpdateCheck();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => cancelTranscription());
}
