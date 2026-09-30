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
| Build tooling | [electron-vite](https://electron-vite.org/) + [Vite](https://vite.dev/) 7 | Bundles the main, preload, and renderer processes |
| Packaging | [electron-builder](https://www.electron.build/) | Produces installers for each platform |
| Language | TypeScript | Across main, preload, and renderer |
| UI | React, Tailwind CSS, [shadcn/ui](https://ui.shadcn.com/) (Radix UI), lucide-react, Inter (bundled) | Renderer (frontend) |
| Audio extraction | [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static), driven via Node.js `child_process` | Bundled FFmpeg binary; decodes any audio/video file straight to 22.05 kHz mono PCM |
| AI transcription | [`@spotify/basic-pitch`](https://github.com/spotify/basic-pitch-ts) | Polyphonic note detection (model bundled locally) |
| ML runtime | [TensorFlow.js](https://www.tensorflow.org/js) with the WebAssembly backend (`@tensorflow/tfjs-backend-wasm`) | Runs the Basic Pitch model on the local CPU, no native binaries |
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

### Why these choices

- **No `fluent-ffmpeg`:** it is deprecated upstream. TaBello only needs one FFmpeg invocation (decode to raw PCM), so it spawns the bundled binary directly.
- **WASM instead of `tfjs-node`:** both were benchmarked inside an Electron 44 `utilityProcess` and produced identical notes. `tfjs-node` was ~3x faster (3.3 s vs 9.5 s for 60 s of audio on 4 cores), but it is unmaintained, needs patches to load on Electron's Node.js 24, and adds ~390 MB of platform-specific native code. The WASM backend is under 1 MB, cross-platform, and fast enough; `tfjs-node` can be added later as an optional accelerator.
- **alphaTab only:** it renders standard notation and tablature and plays them back, so VexFlow is not needed. alphaTab cannot import MIDI, so detected notes are converted to alphaTex; `@tonejs/midi` is used for MIDI export.

## Project Structure

```
src/
├── main/        Electron main process: window, app:// protocol, IPC handlers
├── preload/     contextBridge API exposed to the renderer as window.tabello
├── shared/      Types and IPC channel names shared by main, preload and renderer
└── renderer/    React app (index.html, src/, public/)
```

## Project Status

Early development. The Electron shell, security hardening, and IPC bridge are in place; the transcription pipeline (FFmpeg → Basic Pitch → tablature) is being wired in next. The current UI still uses placeholder note detection.

## How to run

Requirements: Node.js 22.12+ and npm.

```sh
npm install
npm run dev        # start the app with hot reload
npm run typecheck  # type-check main, preload and renderer
npm run build      # production build into out/
npm run dist       # build an installer for the current OS into release/
```

## Contributing

Contributions, issues, and ideas are welcome. Please open an issue to discuss larger changes before submitting a pull request.

## License

To be defined. Note that the bundled FFmpeg binary (`ffmpeg-static`) is distributed under the GPL, which must be taken into account when choosing the project license.
