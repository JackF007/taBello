import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell, type IpcMainInvokeEvent } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IpcChannels, MEDIA_EXTENSIONS, type AppInfo, type MediaFile } from '../shared/ipc';

// In production the renderer is served from a custom `app://` scheme rather than file://,
// so it gets a real origin (needed by alphaTab's workers/worklets) and a CSP header we control.
const APP_SCHEME = 'app';
const APP_HOST = 'tabello';
const APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
const RENDERER_DIR = path.join(import.meta.dirname, '../renderer');
const PRELOAD_PATH = path.join(import.meta.dirname, '../preload/index.cjs');
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const { host, pathname } = new URL(request.url);
    const filePath = path.join(RENDERER_DIR, decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(RENDERER_DIR, filePath);
    if (host !== APP_HOST || relative.startsWith('..') || path.isAbsolute(relative)) {
      return new Response('Not found', { status: 404 });
    }

    const response = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    return new Response(response.body, { status: response.status, headers });
  });
}

function isTrustedUrl(url: string): boolean {
  if (DEV_SERVER_URL) return url.startsWith(DEV_SERVER_URL);
  // Not `URL.origin`: Node reports "null" as the origin of custom schemes.
  const { protocol, host } = new URL(url);
  return protocol === `${APP_SCHEME}:` && host === APP_HOST;
}

/** Rejects IPC calls from anything other than our own renderer (e.g. an injected iframe). */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url;
  if (!url || !isTrustedUrl(url)) {
    throw new Error(`Blocked IPC call from untrusted sender: ${url ?? 'unknown'}`);
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.getAppInfo, (event): AppInfo => {
    assertTrustedSender(event);
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
    };
  });

  ipcMain.handle(IpcChannels.openMediaFile, async (event): Promise<MediaFile | null> => {
    assertTrustedSender(event);
    const options: Electron.OpenDialogOptions = {
      title: 'Open audio or video file',
      properties: ['openFile'],
      filters: [
        { name: 'Audio & video', extensions: [...MEDIA_EXTENSIONS] },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;

    const { size } = await stat(filePath);
    return { path: filePath, name: path.basename(filePath), sizeBytes: size };
  });
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

    registerAppProtocol();
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
