# Notes for Claude

## Git

- Commit and push as the maintainer: run
  `git config user.name "JackF007" && git config user.email "45083625+JackF007@users.noreply.github.com"`
  before the first commit of a session.
- Do not add `Co-Authored-By` or `Claude-Session` lines (or any other Claude attribution) to commit
  messages.
- Name each branch after its change, with a type prefix: `feature/…`, `fix/…`, `docs/…`,
  `refactor/…` or `test/…` (e.g. `feature/solo-bends`, `fix/flaky-e2e-dialog`). Never use `claude/…`
  or session-generated names; start each branch from the latest `main`.
- Commit subjects say what changed for the user, in the imperative or as "Area: change" (e.g.
  "Metronome: take its clicks out, take its beats and bars"), under about 72 characters; the body
  explains why when it is not obvious.
