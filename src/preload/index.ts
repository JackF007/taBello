import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IpcChannels, type TabelloApi, type TranscriptionProgress } from '../shared/ipc';

// Only these typed wrappers cross the bridge: the renderer never gets ipcRenderer or any Node.js API.
const api: TabelloApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo),

  // The path is resolved here from a real File object, so the renderer cannot ask main to read arbitrary paths.
  transcribe: (file, request) =>
    ipcRenderer.invoke(IpcChannels.transcribe, { ...request, path: webUtils.getPathForFile(file) }),
  cancelTranscription: () => ipcRenderer.invoke(IpcChannels.cancelTranscription),
  onTranscriptionProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: TranscriptionProgress) => listener(progress);
    ipcRenderer.on(IpcChannels.transcriptionProgress, handler);
    return () => ipcRenderer.removeListener(IpcChannels.transcriptionProgress, handler);
  },

  listProjects: () => ipcRenderer.invoke(IpcChannels.listProjects),
  getProject: (id) => ipcRenderer.invoke(IpcChannels.getProject, id),
  updateProjectSettings: (id, settings) => ipcRenderer.invoke(IpcChannels.updateProjectSettings, id, settings),
  deleteProject: (id) => ipcRenderer.invoke(IpcChannels.deleteProject, id),
  exportFile: (request) => ipcRenderer.invoke(IpcChannels.exportFile, request),
};

contextBridge.exposeInMainWorld('tabello', api);
