# Releasing TaBello

Releases are built for free by GitHub Actions (`.github/workflows/release.yml`) when a tag matching the
version in `package.json` is pushed. They arrive as a **draft**: nothing is public until the draft is
published by hand, after the checks below.

## 1. Prepare

- [ ] `main` is green in CI (unit tests, lint, typecheck, e2e).
- [ ] `package.json` has the new version (`npm version 0.1.0-beta.2 --no-git-tag-version`), merged.
- [ ] The README describes the features and limitations of this version.

## 2. Build the installers

```sh
git checkout main && git pull
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

The *Release* workflow builds on Windows, macOS (Apple Silicon) and Linux (about 15 minutes) and
attaches the installers to a draft release named after the version.

## 3. Try every installer on a real computer

For each of Windows, macOS and Linux (`.deb` and AppImage):

- [ ] It downloads and installs as the README says (Windows: *More info → Run anyway*; macOS: *System
      Settings → Privacy & Security → Open Anyway*).
- [ ] TaBello opens, and the footer shows the right version.
- [ ] *Isolate*: the separation model downloads by itself at the first start (about 100 MB).
- [ ] A sample track (*Try* on Greensleeves) transcribes and plays.
- [ ] One of your own files (an MP3 and a video) transcribes; *Original* plays it along.
- [ ] *Isolate* on the band sample gives the bass part.
- [ ] Export to Guitar Pro and MIDI; the files open in another program (MuseScore, TuxGuitar).
- [ ] *Show the log* opens the folder with `tabello.log`.
- [ ] Uninstall works, and leaves the transcriptions in the user folder.

## 4. Publish

- [ ] Edit the draft: a short note of what is new and the known limitations; for a beta, tick
      *Set as a pre-release* (beta users are told about it by the update check; others are not).
- [ ] Publish. From now on, installed copies offer it at startup (*Check for updates*).
- [ ] Announce it; feedback arrives through *Report a problem* (GitHub issue forms).

## If something is wrong

Delete the draft and the tag (`git push origin :refs/tags/v0.1.0-beta.1`), fix on a branch, merge,
and tag again. A published release is never changed: release a new version instead.
