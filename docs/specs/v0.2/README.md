# cc-use v0.2 Spec Overview

> This document summarizes the post-MVP feature line up to the `v0.2.3` tag.  
> It is a technical capability snapshot for maintainers, not a release note.

## Positioning

`v0.2` keeps the original launcher model from `v0.1`:

- `cc-use` launches Claude Code with provider-specific env
- provider sessions remain isolated under `~/.cc-use/sessions/<profile>/`
- native `~/.claude/` is not reused by `cc-use` in this phase

This phase is best understood as: **MVP stabilization + provider expansion + better migration tooling**.

## Scope added after v0.1

### 1. Default profile flow

`v0.2` makes default-profile usage a first-class path:

- `cc-use` can launch the configured default profile
- `cc-use -p "..."` can pass args through while still using the default profile
- `cc-use default [profile]` becomes part of the normal workflow

Technical effect:

- `~/.cc-use/config.json` stores the default profile
- CLI dispatch now has a no-arg/default path, not only explicit profile launches

### 2. History import and sanitization

`v0.2` expands the history-migration story:

- `cc-use import-history [profile]`
- `cc-use import-history [profile] --all`
- `cc-use import-history [profile] --sanitize`

Purpose:

- copy native Claude Code project history into isolated provider sessions
- avoid mutating the original `~/.claude/`
- allow provider-compatible cleanup for history that cannot be resumed raw

### 3. Provider expansion before `0.3`

Compared with the original MVP template set, `v0.2` already expands the built-in provider surface. By the `v0.2.3` tag, the repo includes support for:

- `deepseek`
- `kimi`, `kimi-plan`
- `glm`, `glm-intl`
- `qwen`, `qwen-plan`, `qwen-intl`
- `minimax`, `minimax-intl`
- `volcengine-plan`, `byteplus-plan`
- `openrouter`
- `custom`

This phase is where the project stops being only a narrow MVP and becomes a broader Anthropic-compatible provider launcher.

### 4. Cross-platform hardening

`v0.2` also includes practical hardening work around:

- Windows path handling
- CLI tests running against built `dist/cli.js`
- isolated home/session handling in tests

This is still the same product model, but with stronger portability and migration reliability.

## Technical boundaries of v0.2

`v0.2` still assumes:

- isolated provider sessions are the only launch model
- switching providers should not share native Claude Code runtime context
- the launcher boundary is still “temporary env injection + isolated `CLAUDE_CONFIG_DIR`”

In other words:

- there is **no** `cc-use with <profile>` yet
- there is **no** shared `~/.claude/` mode yet
- there is **no** explicit `isolate` subcommand yet because isolated launch is still the only model

## What belongs to v0.3 instead

The following are deliberately **not** part of this `v0.2` spec:

- `cc-use with <profile>`
- `cc-use isolate <profile>`
- MiMo / MiMo Token Plan support
- the new product guidance that recommends `with` for daily use

Those belong to [`../v0.3/README.md`](../v0.3/README.md).
