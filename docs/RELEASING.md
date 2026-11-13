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

The *Release* workflow builds on Windows and Linux (about 15 minutes) and attaches the installers to a
draft release named after the version. (macOS is not built yet — see *Signing* below.)

## 3. Try every installer on a real computer

For each of Windows and Linux (`.deb` and AppImage):

- [ ] It downloads and installs as the README says (Windows: *More info → Run anyway*).
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

## Signing: installers that open without warnings

Unsigned, the installers work but each system asks for a confirmation the first time (Windows:
*More info → Run anyway*; macOS: *Privacy & Security → Open Anyway*). Signing removes it. The
release workflow signs by itself as soon as the certificates below are in the repository's
settings (*Settings → Secrets and variables → Actions*); without them it builds as before.

### Windows: SignPath Foundation (free for open source)

[SignPath Foundation](https://about.signpath.io/product/open-source) signs open-source projects for
free. Signing runs on SignPath's servers, so the workflow builds the installer, sends it to SignPath,
and swaps the signed one onto the release — these steps are already in `release.yml` and stay dormant
until the secret below is set. One-time setup, after SignPath accepts the project:

1. Apply at [about.signpath.io/signpath-foundation](https://about.signpath.io/signpath-foundation) and
   wait for approval (they review the project; this is the part that takes time).
2. In the SignPath account, note the **Organization ID**, and create a **Project** (slug e.g.
   `tabello`), a **Signing Policy** (slug e.g. `release-signing`) and an **Artifact Configuration**
   (slug e.g. `exe`) that signs the single `.exe` the build sends. Create an **API token** for CI.
3. In the repository's *Settings → Secrets and variables → Actions*, add:
   - **secret** `SIGNPATH_API_TOKEN`: the API token;
   - **variables** `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`,
     `SIGNPATH_SIGNING_POLICY_SLUG`, `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` (the four slugs above).

The next release is then signed automatically. SmartScreen may still warn about a brand-new
certificate until enough people have installed the app; a signed installer earns trust much faster,
and its warning names the publisher. Linux needs nothing: `.deb` and AppImage install without a warning.

### macOS: Apple Developer ID and notarization (Apple Developer Program, 99 USD a year) — not built yet

macOS is **not built by the workflow right now**: Apple accepts no other way to open an app without a
warning than a Developer ID signature and notarization, which need the paid program. The scaffolding is
ready — to build macOS again, add `macos-latest` back to the matrix in `release.yml` (one commented
line) and add the secrets below.

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) as an individual.
2. In Xcode or on developer.apple.com, create a **Developer ID Application** certificate; export it
   from Keychain Access as a `.p12` file with a password.
3. In App Store Connect → *Users and Access → Integrations → App Store Connect API*, create a key with
   the *Developer* role and download the `.p8` file; note its Key ID and the Issuer ID.
4. Add these **secrets**:
   - `MAC_CERTIFICATE`: the `.p12` file in base64 (`base64 -i certificate.p12 | pbcopy`);
   - `MAC_CERTIFICATE_PASSWORD`: its password;
   - `MAC_IDENTITY`: the certificate's name without the prefix, e.g. `Your Name (AB12CD34EF)`;
   - `APPLE_API_KEY`: the content of the `.p8` file;
   - `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`.

The workflow then signs with the hardened runtime (`build/entitlements.mac.plist`) and notarizes.

## If something is wrong

Delete the draft and the tag (`git push origin :refs/tags/v0.1.0-beta.1`), fix on a branch, merge,
and tag again. A published release is never changed: release a new version instead.
