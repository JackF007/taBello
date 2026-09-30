// Stand-in for the `@tensorflow/tfjs` umbrella package when bundling the transcription worker.
// Basic Pitch only needs core ops and loadGraphModel; the umbrella would also pull in the WebGL,
// layers and data packages.
// Side effect, as in the umbrella: adds chained methods such as tensor.slice(), used by Basic Pitch.
import '@tensorflow/tfjs-core/dist/public/chained_ops/register_all_chained_ops';

export * from '@tensorflow/tfjs-core';
export { loadGraphModel } from '@tensorflow/tfjs-converter';
