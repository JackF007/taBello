# TaBello

**TaBello** is an open-source, offline-first desktop application that turns video and audio files into musical notation and guitar/bass tablature — automatically, and entirely on your own computer.

Drop in an `.mp4`, `.mov`, `.mp3`, `.wav` (or any format FFmpeg understands), and TaBello will:

1. Extract the audio track locally with a bundled FFmpeg binary.
2. Transcribe the notes with a machine-learning pitch-detection model running on your machine.
3. Map the detected notes onto strings and frets.
4. Render standard notation and tablature you can read, play back, and export.

## Features

- **Any audio or video file** up to 15 minutes, via drag & drop or the file picker.
- **Five instruments**: guitar and bass (notation + tablature, common tunings), piano and accordion (grand staff), violin (treble staff).
- **Capo detection** for guitar: open-position shapes played higher up the neck are recognized, and the tab is written relative to the capo (adjustable by hand).
- **Automatic tempo and key detection**; the tempo can be halved, doubled or typed in, and the score updates instantly.
- **Playable fingerings**: notes are placed on strings/frets by an optimizer that keeps chord shapes compact and hand movement small.
- **Notation + tablature** rendered with alphaTab, with synthesized playback, a cursor, a metronome and slow-down; tab numbers are colored by string.
- **Stage-style design**: a dark theme with the Guitar Hero fret colors and animations (disabled automatically when the system asks for reduced motion).
- **Original recording** (audio or video) playable next to the score.
- **Export** to Guitar Pro 7 (`.gp`, opens in Guitar Pro, MuseScore, TuxGuitar), MIDI (`.mid`) and alphaTex.
- **Local library** of all transcriptions, stored in the app's data folder.

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
| MIDI export | [`@tonejs/midi`](https://github.com/Tonejs/Midi) | Writes the detected notes as a standard MIDI file |
| Notation & tabs | [alphaTab](https://alphatab.net/) (`@coderline/alphatab`) | Renders standard notation + tablature, with built-in playback |
| Local storage | Node.js `fs` in the app's user-data directory | Saves projects (JSON) on disk |
| Data fetching | TanStack Query | Caches IPC calls in the renderer |
| Testing | Vitest, Playwright (Electron) | Unit/integration tests; end-to-end runs of the packaged app |
| CI / releases | GitHub Actions | Checks every PR; builds installers for all platforms on tag push |

### Architecture at a glance

```
┌──────────────────────────── Renderer (React) ────────────────────────────┐
│ Transcribe · Library · Project pages                                     │
│ Music engine (pure TS): tempo & key detection → 16th-note quantization → │
│ Viterbi fingering → alphaTex → alphaTab score/playback · MIDI/GP export  │
└───────────────▲──────────────────────────────────────────────┬───────────┘
                │ window.tabello.* (typed API via contextBridge)│
┌───────────────┴──────────────── Preload ─────────────────────▼───────────┐
│ Minimal, typed IPC surface — no Node.js in the renderer                  │
└───────────────▲──────────────────────────────────────────────┬───────────┘
                │ ipcRenderer.invoke / progress events          │
┌───────────────┴───────────────── Main process ───────────────▼───────────┐
│ IPC handlers (sender + input validation) · project store (JSON files)    │
│ app:// protocol (renderer + CSP) · tabello-media:// (original file,      │
│ HTTP range requests) · save dialogs · job manager (one job, cancellable) │
│        └── utilityProcess, one per job:                                  │
│            FFmpeg → 22.05 kHz mono PCM → Basic Pitch (TF.js WASM)        │
│            → harmonic filtering + re-trigger merging → notes             │
└──────────────────────────────────────────────────────────────────────────┘
```

### Why these choices

- **No `fluent-ffmpeg`:** it is deprecated upstream. TaBello only needs one FFmpeg invocation (decode to raw PCM), so it spawns the bundled binary directly.
- **WASM instead of `tfjs-node`:** both were benchmarked inside an Electron 44 `utilityProcess` and produced identical notes. `tfjs-node` was ~3x faster (3.3 s vs 9.5 s for 60 s of audio on 4 cores), but it is unmaintained, needs patches to load on Electron's Node.js 24, and adds ~390 MB of platform-specific native code. The WASM backend is under 1 MB, cross-platform, and fast enough; `tfjs-node` can be added later as an optional accelerator.
- **Bundled worker:** the transcription worker is bundled with Vite, using only `tfjs-core`, `tfjs-converter` and the WASM backend (the TF.js npm packages ship every build variant, ~290 MB). The app archive went from 299 MB to 22 MB; the Linux AppImage is ~160 MB, most of it Electron and FFmpeg.
- **alphaTab only:** it renders standard notation and tablature and plays them back, so VexFlow is not needed. alphaTab cannot import MIDI, so detected notes are converted to alphaTex; `@tonejs/midi` is used for MIDI export.
- **Post-processing Basic Pitch:** on a synthetic plucked-string test (riff + strummed chords, 53 notes) the raw model output with default thresholds has precision 0.48 / recall 0.89. Slightly stricter thresholds, dropping quiet overtones and merging the phantom re-onsets of still-ringing notes bring it to 0.83 / 0.85. This is guarded by a regression test; real recordings will vary, which is why the sensitivity is adjustable.

## Project Structure

```
src/
├── main/                 Electron main process
│   ├── index.ts          window, security settings, app lifecycle
│   ├── ipc.ts            IPC handlers (validated)
│   ├── protocols.ts      app:// and tabello-media:// schemes
│   ├── projects.ts       local project library
│   └── transcription/    utility-process worker, FFmpeg + Basic Pitch pipeline
├── preload/              contextBridge API exposed as window.tabello
├── shared/               IPC contract and instrument/tuning presets
└── renderer/             React app
    └── src/lib/music/    tempo/key detection, arrangement, alphaTex/MIDI/GP export
```

## How to run

Requirements: Node.js 22.12+ and npm.

```sh
npm install
npm run dev        # start the app with hot reload
npm test           # unit + integration tests (includes a real FFmpeg + Basic Pitch run)
npm run test:e2e   # builds, then drives the Electron app with Playwright
npm run lint
npm run typecheck  # type-check main, preload and renderer
npm run build      # production build into out/
npm run dist       # build an installer for the current OS into release/
```

`npm install` also downloads the Electron binary for your OS (`postinstall`).

**Windows:** if that step fails with `Cannot find native binding`, install the Microsoft Visual C++ Redistributable (`winget install Microsoft.VCRedist.2015+.x64`), then run `npx install-electron`.

## Distribution (zero cost)

Releases are built by GitHub Actions on free runners: push a tag matching the version in `package.json` (e.g. `git tag v0.1.0 && git push origin v0.1.0`) and installers for Windows, macOS (Apple Silicon) and Linux are attached to a draft GitHub Release. No paid services or certificates are used, so the first launch needs one extra step:

- **macOS** (ad-hoc signed, not notarized): open the app, then go to *System Settings → Privacy & Security* and click *Open Anyway*.
- **Windows** (unsigned): on the SmartScreen prompt, click *More info → Run anyway*.
- **Linux**: `chmod +x TaBello-*.AppImage` and run it.

Free code signing for open-source projects (e.g. [SignPath Foundation](https://signpath.org/) for Windows) can remove the Windows warning later. Apple notarization requires a paid Apple Developer account.

## Contributing

Contributions, issues, and ideas are welcome. Please open an issue to discuss larger changes before submitting a pull request.

## License

To be defined. Note that the bundled FFmpeg binary (`ffmpeg-static`) is distributed under the GPL, which must be taken into account when choosing the project license.
