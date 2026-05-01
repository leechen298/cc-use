# cc-use v0.3 Spec Overview

> This document describes the current technical design line for the `0.3` feature set.  
> It is the maintainers' spec-level summary for the shared-context and explicit-isolation model.

## Positioning

`v0.3` is the first phase where `cc-use` clearly supports **two launch models**:

- shared-context launch via `cc-use with <profile>`
- isolated launch via `cc-use isolate <profile>` or bare `cc-use <profile>`

This changes the product from “isolated launcher only” into “one launcher with two explicit runtime modes”.

## CLI semantics

### `cc-use with <profile>`

Shared-context mode.

- uses native `~/.claude/` as `CLAUDE_CONFIG_DIR`
- keeps Claude Code history, skills, and projects in the native workspace
- switches the backend provider by injecting the selected profile env into the launched child process

This is the recommended daily-use mode when the user already relies on Claude Code locally.

### `cc-use isolate <profile>`

Explicit isolated mode.

- uses `~/.cc-use/sessions/<profile>/`
- keeps provider-specific context separate from native Claude Code
- makes experiments and compatibility debugging easier

### `cc-use <profile>`

Compatibility shorthand.

- current behavior is equivalent to `cc-use isolate <profile>`
- preserved so existing isolated workflows do not break

### `cc-use`

Default-profile launch.

- if a default profile is configured, current runtime behavior remains isolated
- equivalent to launching the default profile in isolated mode

## Design boundaries

### 1. Shared mode is explicit opt-in

`v0.3` does **not** silently change old isolated semantics.

- `with` must be explicit
- bare profile launch remains isolated
- default profile launch also remains isolated

This keeps backward compatibility while making the new daily-use path available.

### 2. Isolation is now both implicit and explicit

In earlier phases, isolation existed only as the default behavior.  
In `v0.3`, it is also exposed as a named command:

```bash
cc-use isolate <profile>
```

This makes docs, onboarding, and future migration clearer.

### 3. Native `~/.claude/` reuse is a supported code path

Unlike earlier phases, `v0.3` intentionally supports a code path that reuses native Claude Code context:

- history
- skills
- projects
- other local Claude Code state stored under `~/.claude/`

That reuse is intentional and limited to `with`.

### 4. Provider scope in v0.3

`v0.3` includes all `v0.2.3` templates plus:

- `mimo`
- `mimo-plan`

Current built-in provider groups for this phase are:

- `deepseek`
- `kimi`, `kimi-plan`
- `glm`, `glm-intl`
- `qwen`, `qwen-plan`, `qwen-intl`
- `minimax`, `minimax-intl`
- `volcengine-plan`, `byteplus-plan`
- `mimo`, `mimo-plan`
- `openrouter`
- `custom`

## Technical implications

### Child environment

`spawnClaude()` must accept an explicit target `claudeConfigDir` instead of inferring only the isolated path internally.

That enables:

- isolated path injection for `isolate` and bare profile launch
- native path injection for `with`

### Documentation model

`v0.3` needs three separate documentation layers:

- current behavior docs
- release notes
- historical specs from older phases

This is why `docs/specs/v0.1/` should remain historical instead of being updated indefinitely with new behavior.

## Non-goals in this phase

`v0.3` still does not introduce:

- automatic provider routing
- shared-mode-as-default behavior
- secret-store integration
- plugin/template download system

The focus of this phase is: **shared-context support, explicit isolated mode, and MiMo provider coverage**.
