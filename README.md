# TaBello

**Turn any recording into guitar, bass or ukulele tabs — entirely on your computer.**

TaBello is a free, open-source desktop app. Give it an audio or video file (a lesson, a live clip, a demo
you recorded) and it listens, detects the notes with a machine-learning model, and writes standard
notation plus tablature you can play back, slow down and export. No account, no upload, no internet
connection needed: your files never leave your machine.

![Transcribe screen](docs/screenshots/transcribe.png)

## Features

- **Guitar, bass and ukulele**, with common tunings: standard, drop D, half step down, D standard, DADGAD,
  open G, 5-string bass, and ukulele high G / low G / D tuning / baritone.
- **Capo detection**: chord parts played with a capo are recognized, and the tab is written relative to
  the capo, as guitarists read it. You can always set the capo by hand.
- **Tempo and key detection**; halve, double or type the tempo and the score updates instantly.
- **Playable fingerings**: notes are placed on strings and frets by an optimizer that keeps chord shapes
  compact and hand movement small.
- **Notation + tablature** with synthesized playback, a cursor, a metronome and slow-down.
  Tab numbers are colored by string.
- **Your original recording** (audio or video) plays next to the score.
- **Export** to Guitar Pro 7 (`.gp` — opens in Guitar Pro, MuseScore, TuxGuitar), MIDI (`.mid`) and alphaTex.
- **Local library** of all your transcriptions.

| Capo detected on a strummed part | Ukulele tab |
| --- | --- |
| ![Project with capo](docs/screenshots/project-capo.png) | ![Ukulele tab](docs/screenshots/ukulele-tab.png) |

## Download and install

Installers for Windows, macOS (Apple Silicon) and Linux will be published on the
[Releases page](https://github.com/JackF007/taBello/releases); until the first release, run TaBello
from source (see [Development](#development)). TaBello uses no paid code-signing certificates, so the
first launch of an installed copy needs one extra click:

- **Windows**: on the SmartScreen prompt, click *More info → Run anyway*.
- **macOS**: open the app once, then go to *System Settings → Privacy & Security* and click *Open Anyway*.
- **Linux**: make the AppImage executable (`chmod +x TaBello-*.AppImage`) and run it.

## How to use it

1. **Pick your instrument** (guitar, bass or ukulele).
2. **Drop a file** or click *Choose file*. Most audio and video formats work (MP3, WAV, FLAC, M4A, MP4,
   MOV, MKV…), up to 15 minutes. Transcription takes a few seconds per minute of audio.
3. **Check the result** on the project page:
   - fix the **tuning** and **capo** if needed (the capo is detected automatically);
   - if the tempo looks off by a factor of two, use **½×** or **2×**;
   - press **Play** to hear the transcription and compare it with the original recording above it.
4. **Export** to Guitar Pro or MIDI to keep editing in your favorite program.

### Getting the best results

Automatic transcription is a starting point, not a finished tab. Accuracy depends a lot on the recording:

- **Solo instrument recordings work best.** In a full band mix, vocals, drums and keys are heard too
  and produce extra or wrong notes.
- **Clean, close recordings beat distant or noisy ones.** Heavy distortion, reverb and effects make
  notes harder to detect.
- **Choose the right instrument before transcribing**: it sets the frequency range the model listens to.
- **Sensitivity**: if you get too many stray notes, try *Strict*; if quiet notes are missing, try
  *Sensitive*.
- **Tuning matters**: if your guitar is tuned down, select that tuning so the frets come out right.

### Known limitations

- Time signature is always 4/4, and rhythms are quantized to 16th notes (triplets and swing are approximated).
- Playing techniques (bends, slides, hammer-ons, vibrato) are not written yet.
- Very fast passages and dense chords can lose notes; overtones can occasionally add an octave note.
- The tempo is assumed constant over the whole piece.

## How it works

1. **FFmpeg** extracts the audio track and converts it to 22.05 kHz mono.
2. **[Basic Pitch](https://github.com/spotify/basic-pitch-ts)**, Spotify's polyphonic note-detection model,
   runs locally with TensorFlow.js (WebAssembly backend) and lists the notes it hears.
3. TaBello cleans the result: it removes quiet overtones and merges the phantom re-attacks the model
   reports for notes that are still ringing.
4. It estimates **tempo** and **key**, quantizes the notes to a 16th-note grid, detects a **capo**, and
   chooses strings and frets with a Viterbi search that balances easy shapes against hand movement.
5. **[alphaTab](https://alphatab.net/)** renders the notation and tablature and plays it back.

Everything runs on your machine; transcription happens in a separate background process so the
window stays responsive.

## Development

Requirements: [Node.js](https://nodejs.org/) 22.12 or newer and Git. On Windows, the
[Microsoft Visual C++ Redistributable](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist)
is also needed to unpack Electron during `npm install`.

```sh
git clone https://github.com/JackF007/taBello.git
cd taBello
npm install        # also downloads the Electron binary for your OS
npm run dev        # start the app with hot reload
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app in development mode |
| `npm test` | Unit and integration tests (includes a real FFmpeg + Basic Pitch run) |
| `npm run test:e2e` | Build, then drive the real app with Playwright |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript checks |
| `npm run build` | Production build into `out/` |
| `npm run dist` | Build an installer for the current OS into `release/` |

If `npm install` fails on Windows with `Cannot find native binding`, install the Visual C++
Redistributable (`winget install Microsoft.VCRedist.2015+.x64`) and run `npx install-electron`.

### Tech stack

Electron, React, TypeScript, Vite (electron-vite), Tailwind CSS with shadcn/ui, FFmpeg, TensorFlow.js
with Spotify Basic Pitch, alphaTab, @tonejs/midi, Vitest, Playwright and GitHub Actions.

### Architecture

```
┌──────────────────────────── Renderer (React) ────────────────────────────┐
│ Transcribe · Library · Project pages                                     │
│ Music engine (pure TS): tempo & key detection → quantization → capo     │
│ detection → Viterbi fingering → alphaTex → alphaTab · MIDI/GP export     │
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
│            → overtone filtering + re-attack merging → notes              │
└──────────────────────────────────────────────────────────────────────────┘
```

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
    └── src/lib/music/    tempo/key detection, arrangement, capo, alphaTex/MIDI/GP export
e2e/                      Playwright tests of the desktop app
```

### Design decisions

- **No `fluent-ffmpeg`**: it is deprecated upstream; TaBello spawns the bundled FFmpeg binary directly.
- **WebAssembly instead of `tfjs-node`**: same results, under 1 MB instead of ~390 MB of unmaintained
  native code, and no platform-specific builds. `tfjs-node` was ~3× faster in a benchmark and could
  come back as an optional accelerator.
- **Bundled worker**: only `tfjs-core`, `tfjs-converter` and the WASM backend are shipped (the app
  archive went from 299 MB to 22 MB).
- **alphaTab** renders notation and tablature and plays them back. It cannot import MIDI, so detected
  notes are converted to alphaTex.
- **Measured post-processing**: on a synthetic plucked-string test (riff + strummed chords, 53 notes),
  raw Basic Pitch output has precision 0.48 / recall 0.89; TaBello's thresholds, overtone filtering and
  re-attack merging bring it to 0.83 / 0.85. A regression test guards these numbers.

### Releases

Releases are built for free by GitHub Actions: push a tag matching the version in `package.json`
(e.g. `git tag v0.1.0 && git push origin v0.1.0`) and installers for Windows, macOS and Linux are
attached to a draft GitHub Release. Builds are unsigned (macOS ad-hoc signed); free code signing for
open-source projects such as [SignPath Foundation](https://signpath.org/) can remove the Windows warning.

## Roadmap

Ideas, roughly by priority — contributions welcome:

- [ ] Accuracy benchmark on real recordings ([GuitarSet](https://guitarset.weebly.com/), CC BY 4.0)
- [ ] Play along with the original recording: synced cursor, A–B loop, slow-down without pitch change
- [ ] Optional source separation to isolate the guitar or bass from a full mix
- [ ] Detect detuned recordings (e.g. A = 432 Hz, tuned half a step down)
- [ ] Write techniques: bends, slides, hammer-ons, pull-offs, vibrato
- [ ] Chord names and chord diagrams
- [ ] Triplets, swing and other time signatures
- [ ] Edit notes directly in the tab

## Contributing

Bug reports, transcription examples and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
For a transcription that came out wrong, a short clip (a few seconds) plus the settings you used helps most.

## License

TaBello is free software: you can redistribute it and/or modify it under the terms of the
[GNU General Public License v3.0 or later](LICENSE).

It builds on many open-source projects — FFmpeg (GPL-3.0), Spotify Basic Pitch and TensorFlow.js
(Apache-2.0), alphaTab (MPL-2.0), Electron and React (MIT), and fonts under the SIL Open Font License.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the full list and their licenses.
