# Changelog

This file tracks user-visible product iterations at a higher level than git commits.

Detailed release notes live under [`docs/releases/`](./releases/README.md).

## 0.5.0

Release-note source: [`docs/releases/0.5.0.md`](./releases/0.5.0.md)

### Changed

- Default launch semantics are now with-first:
  - `cc-use` launches the default profile with native `~/.claude/`
  - `cc-use <profile>` launches the named profile with native `~/.claude/`
  - `cc-use auto` selects a usable profile and launches with native `~/.claude/`
- `cc-use with` now resolves the configured default profile instead of requiring an explicit profile name.
- `cc-use isolate` now resolves the configured default profile and keeps explicit isolated mode available.
- `cc-use isolate auto` runs auto routing and launches the selected profile isolated.

### Compatibility

- `cc-use with auto` remains a compatibility alias for shared auto routing.
- Users who want the old bare-profile isolated behavior should use `cc-use isolate <profile>`.
- Existing isolated session directories under `~/.cc-use/sessions/<profile>/` are preserved.
- No session migration or automatic history import is performed.

### Documentation

- README, README.zh-CN, package metadata, help text, current behavior docs, and release notes now describe the with-first default.
- The v0.5 technical design is tracked in [`docs/specs/v0.5/README.md`](./specs/v0.5/README.md).

## 0.4.0

Release-note source: [`docs/releases/0.4.0.md`](./releases/0.4.0.md)

### Added

- `cc-use auto`
  - Selects the first usable configured profile before launch
  - Keeps the selected launch isolated by default
- `cc-use with auto`
  - Uses the same auto profile routing path
  - Launches the selected profile in shared native `~/.claude/` mode
- `cc-use status`
  - Shows the last known auto-routing usability cache
- Auto-routing configuration under `~/.cc-use/config.json`
  - `fallbackOrder`
  - per-profile `check` blocks
  - cache TTL
- Checker/router split
  - checker produces `UsabilityResult`
  - router only selects profiles where `usable === true`

### Checks

- `probe`
  - Reuses the doctor Messages API probe with a minimal request
- `manual_availability`
  - Lets a profile participate without live provider probing
- `api`
  - Schema path is wired for future balance adapters
  - No concrete balance adapter is bundled in this release

### Clarified

- `cc-use auto` preserves the current isolated default behavior
- `cc-use with auto` is the shared-context form
- Bare `cc-use <profile>` still means isolated mode
- No mid-run provider switching is introduced
- `status.json` is a sanitized cache, not a source of truth
- `recordUsage` is parsed for forward compatibility only; no usage ledger is written

## 0.3.0

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

## 0.2.3

At this point the shipped codebase already includes multiple user-visible additions beyond a patch-level change:

- provider expansion (`mimo`, `mimo-plan`)
- new launch mode (`with`)
- explicit isolated mode (`isolate`)
- doc and CLI semantics updates around default isolated behavior

That is why the next public release is better treated as `0.3.0` rather than another `0.2.x`.
