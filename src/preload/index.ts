import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IpcChannels, type TabelloApi, type TranscriptionProgress } from '../shared/ipc';

// Only these typed wrappers cross the bridge: the renderer never gets ipcRenderer or any Node.js API.
const api: TabelloApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo),

  // The path is resolved here from a real File object, so the renderer cannot ask main to read arbitrary paths.
  transcribe: (file, request) =>
    ipcRenderer.invoke(IpcChannels.transcribe, { ...request, path: webUtils.getPathForFile(file) }),
  transcribeSample: (sampleId, request) => ipcRenderer.invoke(IpcChannels.transcribeSample, sampleId, request),
  cancelTranscription: () => ipcRenderer.invoke(IpcChannels.cancelTranscription),
  onTranscriptionProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: TranscriptionProgress) => listener(progress);
    ipcRenderer.on(IpcChannels.transcriptionProgress, handler);
    return () => ipcRenderer.removeListener(IpcChannels.transcriptionProgress, handler);
  },

  listProjects: () => ipcRenderer.invoke(IpcChannels.listProjects),
  getProject: (id) => ipcRenderer.invoke(IpcChannels.getProject, id),
  updateProjectSettings: (id, settings) => ipcRenderer.invoke(IpcChannels.updateProjectSettings, id, settings),
  updateProjectNotes: (id, notes) => ipcRenderer.invoke(IpcChannels.updateProjectNotes, id, notes),
  resetProjectNotes: (id) => ipcRenderer.invoke(IpcChannels.resetProjectNotes, id),
  deleteProject: (id) => ipcRenderer.invoke(IpcChannels.deleteProject, id),
  exportFile: (request) => ipcRenderer.invoke(IpcChannels.exportFile, request),

  getSeparationModel: () => ipcRenderer.invoke(IpcChannels.separationModelStatus),
  downloadSeparationModel: () => ipcRenderer.invoke(IpcChannels.downloadSeparationModel),
  cancelSeparationModelDownload: () => ipcRenderer.invoke(IpcChannels.cancelSeparationModelDownload),
  importSeparationModel: () => ipcRenderer.invoke(IpcChannels.importSeparationModel),
  deleteSeparationModel: () => ipcRenderer.invoke(IpcChannels.deleteSeparationModel),
  onSeparationModelProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, fraction: number) => listener(fraction);
    ipcRenderer.on(IpcChannels.separationModelProgress, handler);
    return () => ipcRenderer.removeListener(IpcChannels.separationModelProgress, handler);
  },
};

contextBridge.exposeInMainWorld('tabello', api);
