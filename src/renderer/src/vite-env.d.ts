/// <reference types="vite/client" />

import type { TabelloApi } from '../../shared/ipc';

declare global {
  interface Window {
    /** Bridge to the main process, exposed by src/preload/index.ts. */
    tabello: TabelloApi;
  }
}
