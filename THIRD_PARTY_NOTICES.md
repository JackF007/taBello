# Third-party notices

TaBello is licensed under the GNU General Public License v3.0 or later (see [LICENSE](LICENSE)).
It is built on, and its installers redistribute, the following third-party software and assets.
Each remains under its own license. The installed app contains this file, TaBello's LICENSE, FFmpeg's
license next to the FFmpeg binary, Electron's and Chromium's license files, and the font and soundfont
licenses next to those assets; the full license text of every package is in `node_modules/` of a
source checkout.

## Bundled in the app

| Component | Version | License | Copyright / source |
| --- | --- | --- | --- |
| [FFmpeg](https://ffmpeg.org/) (static build, via [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static)) | 7.0.2 | GPL-3.0-or-later | The FFmpeg developers; build by [John Van Sickle](https://johnvansickle.com/ffmpeg/) |
| [Electron](https://www.electronjs.org/) (incl. Chromium and Node.js) | 44.5.1 | MIT (Chromium: BSD-3-Clause and others, see `LICENSES.chromium.html` in the app folder) | Electron contributors; GitHub Inc. |
| [Basic Pitch](https://github.com/spotify/basic-pitch-ts) — code **and model weights** | 1.0.1 | Apache-2.0 | Spotify AB |
| [TensorFlow.js](https://github.com/tensorflow/tfjs) — core, converter, WebAssembly backend | 4.22.0 | Apache-2.0 | Google LLC |
| [alphaTab](https://github.com/CoderLine/alphaTab) | 1.8.4 | MPL-2.0 | Daniel Kuschny and contributors (used unmodified) |
| [Bravura](https://github.com/steinbergmedia/bravura) music font (shipped with alphaTab) | — | SIL OFL 1.1 | Steinberg Media Technologies GmbH |
| SONiVOX EAS soundfont `sonivox.sf2` (shipped with alphaTab) | — | Apache-2.0 | Sonic Network Inc. |
| [@tonejs/midi](https://github.com/Tonejs/Midi) | 2.0.28 | MIT | Yotam Mann |
| [React](https://react.dev/) | 18.3.1 | MIT | Facebook, Inc. and its affiliates |
| [React Router](https://reactrouter.com/) | 6.27.0 | MIT | React Training LLC; Remix Software Inc. |
| [TanStack Query](https://tanstack.com/query) | 5.59.16 | MIT | Tanner Linsley |
| [Radix UI](https://www.radix-ui.com/) primitives (via [shadcn/ui](https://ui.shadcn.com/)) | various | MIT | WorkOS (Radix UI) |
| [Tailwind CSS](https://tailwindcss.com/) (generated styles) | 3.4.17 | MIT | Tailwind Labs, Inc. |
| [Lucide](https://lucide.dev/) icons | 0.462.0 | ISC | Lucide contributors; Cole Bemis (Feather) |
| [Inter](https://rsms.me/inter/) font | 5.3.0 | SIL OFL 1.1 | The Inter Project Authors |
| [Russo One](https://fonts.google.com/specimen/Russo+One) font | 5.3.0 | SIL OFL 1.1 | Jovanny Lemonad |

Smaller MIT/ISC/BSD-licensed helper packages (class-variance-authority, clsx, tailwind-merge, sonner, …)
are bundled into the user interface; their licenses are in `node_modules/<package>/LICENSE`.
To list every dependency with its license, run `npx license-checker --summary` in a source checkout.

## FFmpeg source code

FFmpeg is distributed under the GPL v3. Its complete corresponding source code is available from the
FFmpeg project (<https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz>), and the static build's
configuration and the sources of the libraries it includes are published by its builder at
<https://johnvansickle.com/ffmpeg/>. TaBello runs FFmpeg as a separate, unmodified program.
If those links ever stop working, open an issue in the TaBello repository and we will provide the source.

## Training data and models

TaBello does not train any model. Basic Pitch's pretrained weights are redistributed unchanged under
Apache-2.0; see the [Basic Pitch paper](https://arxiv.org/abs/2203.09893) for how they were trained.
