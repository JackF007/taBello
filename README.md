# TaBello

**TaBello** is an open-source, offline-first desktop application that turns video and audio files into musical notation and guitar/bass tablature — automatically, and entirely on your own computer.

Drop in an `.mp4`, `.mov`, `.mp3`, `.wav` (or any format FFmpeg understands), and TaBello will:

1. Extract the audio track locally with a bundled FFmpeg binary.
2. Transcribe the notes with a machine-learning pitch-detection model running on your machine.
3. Map the detected notes onto strings and frets.
4. Render standard notation and tablature you can read, play back, and export.

## Principles

- **100% local.** No servers, no cloud APIs, no accounts. Your files never leave your machine.
- **Offline-first.** Everything the app needs (FFmpeg, the ML model, fonts, soundfonts) ships inside the installer.
- **Open source.** Free to use, study, and improve.

## Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Desktop shell | [Electron](https://www.electronjs.org/) | Cross-platform desktop app (Windows, macOS, Linux) |
| Build tooling | [electron-vite](https://electron-vite.org/) + [Vite](https://vite.dev/) | Bundles the main, preload, and renderer processes |
| Packaging | [electron-builder](https://www.electron.build/) | Produces installers for each platform |
| Language | TypeScript | Across main, preload, and renderer |
| UI | React, Tailwind CSS, [shadcn/ui](https://ui.shadcn.com/) (Radix UI), lucide-react | Renderer (frontend) |
| Audio extraction | [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) + [`fluent-ffmpeg`](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) | Bundled FFmpeg binary; decodes any audio/video file to 22.05 kHz mono PCM |
| AI transcription | [`@spotify/basic-pitch`](https://github.com/spotify/basic-pitch-ts) | Polyphonic note detection (model bundled locally) |
| ML runtime | [TensorFlow.js](https://www.tensorflow.org/js) — `@tensorflow/tfjs-node` (WASM backend as fallback) | Runs the Basic Pitch model on the local CPU |
| Note model / MIDI | [`@tonejs/midi`](https://github.com/Tonejs/Midi) | Canonical note representation and MIDI import/export |
| Notation & tabs | [alphaTab](https://alphatab.net/) (`@coderline/alphatab`) | Renders standard notation + tablature, with built-in playback |
| Local storage | Node.js `fs` in the app's user-data directory | Saves projects, transcriptions, and exports on disk |

### Architecture at a glance

```
┌──────────────────────────── Renderer (React) ────────────────────────────┐
│  File picker / drag & drop · progress UI · alphaTab score + tab viewer   │
└───────────────▲──────────────────────────────────────────────┬───────────┘
                │ window.tabello.* (typed API via contextBridge)│
┌───────────────┴──────────────── Preload ─────────────────────▼───────────┐
│  Exposes a minimal, whitelisted IPC surface — no Node.js in the renderer │
└───────────────▲──────────────────────────────────────────────┬───────────┘
                │ ipcRenderer.invoke / events                   │
┌───────────────┴───────────────── Main process ───────────────▼───────────┐
│  Dialogs · file system · job orchestration · FFmpeg audio extraction     │
│        └── utilityProcess: Basic Pitch + TensorFlow.js inference         │
└──────────────────────────────────────────────────────────────────────────┘
```

## Project Status

Early development. The project is being migrated from a web prototype to the local-first Electron architecture described above.

## How to run

_Coming soon._

## Contributing

Contributions, issues, and ideas are welcome. Please open an issue to discuss larger changes before submitting a pull request.

## License

To be defined. Note that the bundled FFmpeg binary (`ffmpeg-static`) is distributed under the GPL, which must be taken into account when choosing the project license.
