// Watches the fretting hand in a video, on the user's computer: a frame every half second, the neck
// found in it (fretboard.ts, in a worker) and the hand by MediaPipe's hand landmarker (Google,
// Apache-2.0, bundled with the app). The result says, moment by moment, which frets the fingertips
// were on; it guides where the notes are written (arrange.ts), it does not change which notes.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandVision, HandWindow } from '../../../../shared/ipc';
import { fretAt, toStraight, type Neck } from './fretboard';
import type { NeckRequest, NeckResponse } from './neck.worker';

/** Seconds between the frames looked at. */
const STEP = 0.5;
/** A close-up is trusted when the neck is also seen in another frame this close. */
const SHOT_SECONDS = 1.2;
/** Width the frames are analysed at. */
const WIDTH = 640;
/** MediaPipe's fingertips: index, middle, ring, little finger. */
const TIPS = [8, 12, 16, 20];

let landmarker: Promise<HandLandmarker> | null = null;

function handLandmarker(): Promise<HandLandmarker> {
  landmarker ??= FilesetResolver.forVisionTasks('./vision/wasm')
    .then((files) =>
      HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: './vision/hand_landmarker.task', delegate: 'CPU' },
        runningMode: 'IMAGE',
        numHands: 2,
        // Lesson videos are often dim and the hand is seen from above: accept weak detections, the
        // neck check below filters what is not a hand on the frets.
        minHandDetectionConfidence: 0.1,
        minHandPresenceConfidence: 0.1,
      }),
    )
    .catch((error: unknown) => {
      // Not kept: the next video tries to load the model again.
      landmarker = null;
      throw error;
    });
  return landmarker;
}

function loadVideo(url: string, signal?: AbortSignal): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    // The frames are read back from a canvas: the media must allow it (see protocols.ts).
    video.crossOrigin = 'anonymous';
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error('The video could not be read.'));
    signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')));
    video.src = url;
  });
}

/** Speed the video is run through: much faster than seeking frame by frame (each seek decodes again). */
const PLAYBACK_RATE = 8;

/**
 * Calls `look` on a frame every STEP seconds of the video, in order, pausing the (muted) video while
 * it looks. Frames are delivered only while the window is in sight, so the video also waits while
 * TaBello is minimized or hidden: otherwise it would run on unwatched and parts would be missed.
 */
function everyStep(video: HTMLVideoElement, look: (time: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let next = 0;
    let done = false;
    let looking = false;
    const play = () => {
      if (!done && !looking && !document.hidden) void video.play().catch(finish);
    };
    const onVisibility = () => (document.hidden ? video.pause() : play());
    const finish = (error?: unknown) => {
      if (done) return;
      done = true;
      document.removeEventListener('visibilitychange', onVisibility);
      video.pause();
      if (error) reject(error);
      else resolve();
    };
    signal?.addEventListener('abort', () => finish(new DOMException('Stopped', 'AbortError')));
    document.addEventListener('visibilitychange', onVisibility);
    video.onended = () => finish();
    video.onerror = () => finish(new Error('The video could not be read.'));
    const onFrame = (_now: number, frame: VideoFrameCallbackMetadata) => {
      if (done) return;
      if (frame.mediaTime + 1e-3 < next) {
        video.requestVideoFrameCallback(onFrame);
        return;
      }
      video.pause();
      looking = true;
      const time = frame.mediaTime;
      next = time + STEP;
      look(time).then(() => {
        looking = false;
        if (done) return;
        video.requestVideoFrameCallback(onFrame);
        play();
      }, finish);
    };
    video.playbackRate = PLAYBACK_RATE;
    video.requestVideoFrameCallback(onFrame);
    play();
  });
}

/** Which frets the fretting hand's fingertips are on, if a neck and that hand are both in sight. */
function fingertipFrets(neck: Neck, hands: { x: number; y: number }[][], width: number, height: number): number[] {
  // The fretting hand is the one nearer the nut; the other one plucks over the body.
  const towardsNut = (hand: { x: number; y: number }[]) => {
    const along = hand.reduce((sum, p) => sum + toStraight({ x: p.x * width, y: p.y * height }, neck.angle, width, height).x, 0) / hand.length;
    return neck.mirrored ? -along : along;
  };
  const fretting = [...hands].sort((a, b) => towardsNut(b) - towardsNut(a))[0];
  if (!fretting) return [];
  return TIPS.map((i) => fretAt(neck, { x: fretting[i].x * width, y: fretting[i].y * height }, width, height)).filter((f): f is number => f !== null);
}

export interface WatchOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Watches the fretting hand in the video at `url` (an audio file has nothing to watch). */
export async function watchHand(url: string, { onProgress, signal }: WatchOptions = {}): Promise<HandVision> {
  const [video, hands] = await Promise.all([loadVideo(url, signal), handLandmarker()]);
  const windows: HandWindow[] = [];
  const closeUpTimes: number[] = [];
  let frames = 0;
  let closeUps = 0;
  if (!video.videoWidth || !Number.isFinite(video.duration)) return { version: 1, windows, frames, closeUps };

  const width = WIDTH;
  const height = Math.round((video.videoHeight / video.videoWidth) * WIDTH);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const worker = new Worker(new URL('./neck.worker.ts', import.meta.url), { type: 'module' });
  const necks = new Map<number, (neck: Neck | null) => void>();
  let workerFailed = false;
  worker.onmessage = (event: MessageEvent<NeckResponse>) => {
    necks.get(event.data.id)?.(event.data.neck);
    necks.delete(event.data.id);
  };
  // A worker that cannot run answers nothing: count its frames as showing no neck instead of waiting.
  worker.onerror = (event) => {
    console.warn('The neck finder could not run', event.message);
    workerFailed = true;
    for (const resolve of necks.values()) resolve(null);
    necks.clear();
  };
  const findNeck = (id: number, rgba: Uint8ClampedArray) =>
    new Promise<Neck | null>((resolve) => {
      if (workerFailed) return resolve(null);
      necks.set(id, resolve);
      const request: NeckRequest = { id, width, height, rgba };
      worker.postMessage(request, [rgba.buffer]);
    });

  try {
    await everyStep(video, async (time) => {
      try {
        context.drawImage(video, 0, 0, width, height);
        frames++;
        const pixels = context.getImageData(0, 0, width, height);
        // Hands are looked for only in close-ups of the neck, the slower step.
        const neck = await findNeck(frames, pixels.data);
        if (neck) {
          closeUps++;
          closeUpTimes.push(Number(time.toFixed(2)));
          const frets = fingertipFrets(neck, hands.detect(canvas).landmarks, width, height);
          // Two fingertips on the frets at least: one alone may be the thumb or a stray point.
          if (frets.length >= 2) windows.push({ time: Number(time.toFixed(2)), low: Math.min(...frets), high: Math.max(...frets) });
        }
      } catch (error) {
        // One frame that cannot be read is skipped: the others still tell where the hand is.
        console.warn('A video frame could not be watched', error);
      }
      onProgress?.(Math.min(1, (time + STEP) / video.duration));
    }, signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // The video stopped being readable part of the way: what was seen up to there still helps.
    if (frames === 0) throw error;
    console.warn('The video could be watched only in part', error);
  } finally {
    worker.terminate();
    video.removeAttribute('src');
    video.load();
  }
  // A close-up lasts: a neck seen in one frame alone is more likely something else (a wide shot).
  const lasting = windows.filter((w) => closeUpTimes.some((t) => t !== w.time && Math.abs(t - w.time) <= SHOT_SECONDS));
  return { version: 1, windows: lasting, frames, closeUps };
}
