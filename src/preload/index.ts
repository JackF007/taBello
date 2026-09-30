import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type TabelloApi } from '../shared/ipc';

// Only these typed wrappers cross the bridge: the renderer never gets ipcRenderer or any Node.js API.
const api: TabelloApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo),
  openMediaFile: () => ipcRenderer.invoke(IpcChannels.openMediaFile),
};

contextBridge.exposeInMainWorld('tabello', api);
