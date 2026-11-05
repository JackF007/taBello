// Finds the neck in video frames off the main thread (about a tenth of a second per frame).
import { findNeck, grayFromRgba, type Neck } from './fretboard';

export interface NeckRequest {
  id: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface NeckResponse {
  id: number;
  neck: Neck | null;
}

self.onmessage = (event: MessageEvent<NeckRequest>) => {
  const { id, width, height, rgba } = event.data;
  const response: NeckResponse = { id, neck: findNeck(grayFromRgba(rgba, width, height)) };
  self.postMessage(response);
};
