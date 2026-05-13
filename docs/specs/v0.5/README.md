# cc-use v0.5 Spec Overview

> This document defines the planned `v0.5` with-first CLI semantics.
> It is a maintainers' technical design spec, not a release note.
>
> This is a planning document only. It does not describe an already implemented
> or already released package state.

## 1. Positioning

`v0.5` changes the default launcher semantics from:

```text
isolated by default
```

to:

```text
with-first by default
```

Product position:

```text
cc-use is a with-first Claude Code profile launcher.

By default, cc-use reuses the native Claude Code context under ~/.claude/
and only swaps provider/profile environment variables.

Explicit isolate mode remains available for users who want a separate
CLAUDE_CONFIG_DIR per profile.
```

This change is needed because `with` is the more natural daily-driver mode.
Users usually want to preserve native Claude Code history, skills, projects,
settings, and other user context while swapping the backend provider/profile
environment for one launch.

Profile switching should feel like swapping provider/profile environment
variables, not entering a separate Claude Code world. Isolated sessions remain
useful for experiments, strong separation, and provider-specific history, but
they should no longer be the default path.

Terminology:

- The routing and launch unit is `profile`.
- Do not call the routing unit `model`.
- Provider/model details are inside profile env.
- Profile files remain env-focused.

Profile files still live under:

```text
~/.cc-use/providers/<name>.json
```

## 2. v0.5 CLI semantics matrix

New desired behavior:

| Command | v0.5 meaning |
| --- | --- |
| `cc-use` | launch default profile in shared / with mode |
| `cc-use <profile>` | launch named profile in shared / with mode |
| `cc-use with` | launch default profile in shared / with mode |
| `cc-use with <profile>` | launch named profile in shared / with mode |
| `cc-use auto` | auto-select usable profile, then launch in shared / with mode |
| `cc-use with auto` | compatibility alias for shared auto |
| `cc-use isolate` | launch default profile in isolated mode |
| `cc-use isolate <profile>` | launch named profile in isolated mode |
| `cc-use isolate auto` | auto-select usable profile, then launch in isolated mode |

Examples:

```bash
cc-use
cc-use deepseek
cc-use with
cc-use with deepseek
cc-use auto
cc-use with auto
cc-use isolate
cc-use isolate deepseek
cc-use isolate auto
```

`cc-use with auto` remains valid for compatibility. The preferred shared auto
command in `v0.5` is:

```bash
cc-use auto
```

## 3. Pass-through argument semantics

Pass-through examples:

```bash
cc-use -p "review this"
cc-use -- -p "review this"
cc-use deepseek -p "review this"
cc-use with -p "review this"
cc-use with -- -p "review this"
cc-use auto -p "review this"
cc-use isolate deepseek -p "review this"
cc-use isolate auto -p "review this"
```

Rules:

- Args after command/profile continue to pass through to `claude`.
- A first argument starting with `-` must not be treated as a profile.
- `--` explicitly separates cc-use command parsing from Claude args.
- `cc-use -- -p "..."` uses the default profile in shared / with mode and
  passes `-p "..."` to Claude.
- `cc-use with -p "..."` uses the default profile and passes `-p "..."` to
  Claude.
- `cc-use isolate -p "..."` uses the default profile in isolated mode and
  passes `-p "..."` to Claude.
- `cc-use auto -p "..."` auto-selects a profile and passes args through to
  Claude.
- `cc-use isolate auto -p "..."` auto-selects a profile, launches isolated, and
  passes args through to Claude.

Expected interpretations:

| Command | Profile selection | Launch mode | Claude args |
| --- | --- | --- | --- |
| `cc-use -p "review this"` | default profile | shared / with | `-p "review this"` |
| `cc-use -- -p "review this"` | default profile | shared / with | `-p "review this"` |
| `cc-use deepseek -p "review this"` | `deepseek` | shared / with | `-p "review this"` |
| `cc-use with -p "review this"` | default profile | shared / with | `-p "review this"` |
| `cc-use with -- -p "review this"` | default profile | shared / with | `-p "review this"` |
| `cc-use auto -p "review this"` | auto routing | shared / with | `-p "review this"` |
| `cc-use isolate deepseek -p "review this"` | `deepseek` | isolated | `-p "review this"` |
| `cc-use isolate auto -p "review this"` | auto routing | isolated | `-p "review this"` |

Parsing guidance for later implementation:

- Empty mode args mean "resolve the default profile".
- Mode args whose first item starts with `-` mean "resolve the default profile
  and preserve all args for Claude".
- Mode args whose first item is `--` mean "resolve the default profile and pass
  the args after `--` to Claude".
- In `with` mode, `auto` remains the only reserved profile-like token that
  dispatches to shared auto routing.
- In `isolate` mode, `auto` dispatches to isolated auto routing.

## 4. Default profile resolution

### Default profile consumers

The following commands resolve the configured default profile when no explicit
profile name is provided:

```bash
cc-use
cc-use with
cc-use isolate
cc-use with -p "..."
cc-use isolate -p "..."
cc-use -- -p "..."
```

Also:

```bash
cc-use -p "..."
```

uses the default profile in shared / with mode.

### No default profile

If no default profile is configured:

- Non-interactive mode prints a clear error and exits non-zero.
- Interactive mode may reuse the existing choose-default-or-init flow if
  available.

Suggested default error wording:

```text
cc-use: no default profile set. Run 'cc-use default <profile>' or 'cc-use init'.
```

For `with` specifically:

```text
cc-use with: no default profile set. Run 'cc-use default <profile>' or 'cc-use init'.
```

For `isolate` specifically:

```text
cc-use isolate: no default profile set. Run 'cc-use default <profile>' or 'cc-use init'.
```

### Broken default profile

If the configured default profile does not exist:

- Preserve the existing behavior as much as possible.
- Non-interactive mode should fail clearly.
- Interactive mode may unset/recover through the existing flow.
- `CC_USE_DEFAULT` environment override should continue to be respected.

Default profile lookup continues to mean:

1. Use `CC_USE_DEFAULT` when present.
2. Otherwise use the configured default in `~/.cc-use/config.json`.
3. Otherwise enter the no-default path above.

## 5. Launch mode definitions

### Shared / with mode

Uses:

```text
CLAUDE_CONFIG_DIR=~/.claude
```

This is the default in `v0.5`.

It preserves native Claude Code:

- history
- skills
- projects
- settings
- existing Claude Code user context

Shared / with mode still injects the selected profile env into the launched
Claude Code child process. The launch changes provider/profile environment
variables for that process, but does not create a separate Claude Code user
state directory.

### Isolated mode

Uses:

```text
CLAUDE_CONFIG_DIR=~/.cc-use/sessions/<profile>
```

This is only used through explicit `isolate`.

It is useful for:

- testing providers
- strong separation
- provider-specific Claude Code history
- avoiding native Claude Code state sharing

## 6. Relationship with v0.4 auto routing

`v0.5` does not change the `v0.4` checker/router abstraction.

Auto routing still means:

```text
select the first usable profile before launch
```

The only change is the launch mode after profile selection:

| Command | Profile selection | Launch mode |
| --- | --- | --- |
| `cc-use auto` | auto routing | shared / with |
| `cc-use with auto` | auto routing | shared / with |
| `cc-use isolate auto` | auto routing | isolated |

Do not redefine `UsabilityResult`.

Do not change:

- checker/router split
- status cache semantics
- `usable` routing rule
- `probe` behavior
- `manual_availability`
- `status.json`

Do not expand auto routing into:

- model selection
- task difficulty routing
- provider quality scoring
- mid-run failover
- worker mode

The checker can continue to explain the world. The router should continue to
select only by `usable`.

## 7. Backward compatibility and migration

This is a behavior change from the old shorthand.

Before `v0.5`:

```bash
cc-use deepseek
```

meant:

```text
launch deepseek in isolated mode
```

Since `v0.5`:

```bash
cc-use deepseek
```

means:

```text
launch deepseek in shared / with mode
```

Users who want the old behavior should use:

```bash
cc-use isolate deepseek
```

Migration note:

```text
Since v0.5, `cc-use <profile>` uses shared native Claude Code context by default.
Use `cc-use isolate <profile>` for per-profile isolated CLAUDE_CONFIG_DIR.
```

Compatibility details:

- Existing isolated session directories are preserved.
- `v0.5` does not delete, rewrite, or migrate existing isolated sessions.
- `remove --delete-session` remains the explicit cleanup path.
- `import-history` remains useful for isolated sessions but is no longer
  required for the default daily-driver path.

## 8. Expected implementation guidance

This is documentation only. Do not implement these changes in this task.

Expected code changes later:

- `launchWithDefault()` should use `NATIVE_CLAUDE_DIR`.
- `launchWithDefault(['--', ...])` should resolve the default profile and pass
  args after `--`.
- `launchByName()` should use `NATIVE_CLAUDE_DIR`.
- `case 'auto'` should call shared auto routing by default.
- `launchWithProfile([])` should resolve the default profile instead of
  erroring.
- `launchWithProfile(args starting with '-')` should resolve default profile
  and pass args through.
- `launchWithProfile(['--', ...])` should resolve default profile and pass args
  after `--`.
- `launchIsolated([])` should resolve the default profile instead of erroring.
- `launchIsolated(args starting with '-')` should resolve default profile and
  pass args through.
- `launchIsolated(['auto', ...])` should support isolated auto.
- `cc-use with auto` should remain supported as a compatibility alias.
- Help text should be updated.
- README and README.zh-CN should be updated later.
- Package description should be updated from isolated-first to with-first.
- Tests should be updated to reflect with-first semantics.

Consider extracting a shared helper for resolving the default profile and
handling no-default / broken-default recovery, so with/default/isolate paths do
not duplicate behavior.

Suggested parser intent:

- Top-level `cc-use auto` dispatches to shared auto.
- Top-level `cc-use <profile>` dispatches to shared explicit profile.
- Top-level `cc-use -...` dispatches to shared default profile with pass-through
  args.
- Top-level `cc-use -- ...` dispatches to shared default profile with the args
  after `--` passed through to Claude.
- `cc-use with` is an explicit spelling of shared default profile.
- `cc-use isolate` is the explicit spelling of isolated default profile.

## 9. Future test plan

Behavioral tests to add or update later:

- `cc-use` uses default profile with native `~/.claude`.
- `cc-use -p "x"` uses default profile with native `~/.claude` and passes args
  through.
- `cc-use -- -p "x"` uses default profile with native `~/.claude` and passes
  args after `--` through.
- `cc-use <profile>` uses native `~/.claude`.
- `cc-use <profile> -p "x"` uses native `~/.claude` and passes args through.
- `cc-use with` uses default profile with native `~/.claude`.
- `cc-use with -p "x"` uses default profile with native `~/.claude` and passes
  args through.
- `cc-use with -- -p "x"` uses default profile with native `~/.claude` and
  passes args through.
- `cc-use with <profile>` uses native `~/.claude`.
- `cc-use auto` selects usable profile and uses native `~/.claude`.
- `cc-use with auto` still works and uses native `~/.claude`.
- `cc-use isolate` uses default profile with isolated session dir.
- `cc-use isolate -p "x"` uses default profile with isolated session dir and
  passes args through.
- `cc-use isolate <profile>` uses isolated session dir.
- `cc-use isolate auto` selects usable profile and uses isolated session dir.
- Pass-through args still work in shared and isolated modes.
- No default profile still errors clearly in non-TTY mode.
- Missing profile errors remain clear.
- Auto checker/router behavior remains unchanged.
- Old test expecting `cc-use with` to error should be replaced.

The test suite should continue to isolate state through `CC_USE_DIR` and should
assert `CLAUDE_CONFIG_DIR` behavior through the spawned child env rather than by
touching real user directories.

## 10. Non-goals

`v0.5` does not introduce:

- worker mode
- observable external agent execution
- mid-run provider switching
- automatic model selection
- automatic balance adapter implementation
- usage ledger
- config editing commands
- session migration between native and isolated modes
- automatic import of isolated history into native `~/.claude`
- automatic import of native history into isolated sessions

## 11. Decisions

1. `cc-use with auto` remains supported as a compatibility alias. The preferred
   command is `cc-use auto`.
2. The release should be `0.5.0` because this changes default CLI behavior.
3. README should show `cc-use deepseek` and `cc-use auto` as primary examples
   after `v0.5`. `cc-use with deepseek` can remain documented as the explicit
   shared spelling.
4. `cc-use isolate` without a profile should be documented as a convenience
   shortcut for isolating the default profile, but not as the primary
   daily-driver path.
5. Help text should keep the current command-list style, but clearly state that
   shared / with mode is the default.
6. The CLI should not show a one-time migration warning. Migration should be
   documented in README and release notes.
