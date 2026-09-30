import type { TabelloApi } from '../../../shared/ipc';

/**
 * The preload bridge. Undefined only when the renderer is opened outside Electron
 * (e.g. the Vite dev URL in a normal browser), which the UI reports instead of crashing.
 */
export const tabello: TabelloApi | undefined = window.tabello;

export function requireApi(): TabelloApi {
  if (!tabello) throw new Error('TaBello must be run as a desktop app (npm run dev), not in a browser.');
  return tabello;
}
