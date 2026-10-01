# Contributing to TaBello

Thanks for helping! TaBello is a small project, so every bug report, test recording and pull request
makes a difference.

## Reporting a problem

- **Something broke** (crash, error message, a button that does nothing): open a
  [bug report](https://github.com/JackF007/taBello/issues/new?template=bug_report.md) with your
  operating system, the TaBello version (shown at the bottom of the window) and the steps to reproduce.
- **A transcription came out wrong**: open a
  [transcription report](https://github.com/JackF007/taBello/issues/new?template=transcription.md).
  The most useful thing you can attach is a **short clip** (5–30 seconds) where it goes wrong, plus the
  instrument, tuning, capo and sensitivity you used, and what the correct notes are. Only share audio
  you have the right to share.

## Development setup

You need [Node.js](https://nodejs.org/) 22.12+ and Git (on Windows also the Microsoft Visual C++
Redistributable; see the README).

```sh
git clone https://github.com/JackF007/taBello.git
cd taBello
npm install
npm run dev
```

Before opening a pull request, run the same checks as CI:

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e   # on Linux without a display: xvfb-run -a npm run test:e2e
```

## Where things are

- `src/main/transcription/` — audio decoding (FFmpeg) and note detection (Basic Pitch) in a background process.
- `src/renderer/src/lib/music/` — the music engine: tempo, key, quantization, capo, fingering, alphaTex,
  MIDI and Guitar Pro export. It is plain TypeScript with unit tests, a good place to start.
- `src/shared/instruments.ts` — instruments and tunings. Adding a tuning is a one-line change.
- `src/renderer/src/pages/` — the three screens (Transcribe, Library, Project).

## Pull requests

- Keep each pull request focused on one change, and describe what it fixes or adds.
- Add or update tests for behavior changes. For transcription accuracy, show the before/after numbers
  of the accuracy test (`src/main/transcription/pipeline.test.ts`) or of a recording you used.
- Follow the existing code style (TypeScript strict, ESLint, small pure functions in the music engine).
- TaBello runs fully offline: please do not add network calls, telemetry or online services.
- New dependencies must have a license compatible with GPL-3.0 and be listed in `THIRD_PARTY_NOTICES.md`
  if they end up in the app.

## License

By contributing, you agree that your contributions are licensed under the
[GNU General Public License v3.0 or later](LICENSE), like the rest of the project.
