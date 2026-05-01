# Changelog

This file tracks user-visible product iterations at a higher level than git commits.

Detailed release notes live under [`docs/releases/`](./releases/README.md).

## 0.3.0 (planned)

Recommended next release line for the current feature set.

Release-note source: [`docs/releases/0.3.0.md`](./releases/0.3.0.md)

### Added

- `cc-use with <profile>` shared-context mode
  - Reuses native `~/.claude/`
  - Lets users keep Claude Code history, skills, and projects while switching providers
- `cc-use isolate <profile>` explicit isolated-session mode
  - Makes the isolated launch path visible and easier to document
- Xiaomi MiMo provider templates
  - `mimo`
  - `mimo-plan`

### Clarified

- Bare `cc-use <profile>` remains isolated mode
- Bare `cc-use` with a default profile also remains isolated mode
- README and help text now distinguish:
  - `with` = shared daily-use mode
  - `isolate` = explicit isolated mode
  - bare profile = isolated shorthand

### Documentation

- Added MiMo documentation to README and README.zh-CN
- Added notes/article draft for MiMo + `with` workflow
- Updated historical spec wording so it no longer contradicts shipped `with` behavior

## 0.2.3 (current package version in repo)

Current `package.json` still says `0.2.3`.

At this point the shipped codebase already includes multiple user-visible additions beyond a patch-level change:

- provider expansion (`mimo`, `mimo-plan`)
- new launch mode (`with`)
- explicit isolated mode (`isolate`)
- doc and CLI semantics updates around default isolated behavior

That is why the next public release is better treated as `0.3.0` rather than another `0.2.x`.
