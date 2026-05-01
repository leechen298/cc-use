# 02_profile-remove.md — Profile removal and default recovery

> Status: proposed implementation plan
> Scope: add `cc-use remove <profile>` and improve no-default / broken-default startup recovery
> Target phase: v0.3 follow-up

## Background

`cc-use` already has commands for creating, listing, validating, selecting, and importing history for profiles:

- `cc-use init`
- `cc-use ls`
- `cc-use default`
- `cc-use doctor`
- `cc-use import-history`
- `cc-use with`
- `cc-use isolate`

It does not currently provide a first-class way to remove a profile.

Technically, making a profile unavailable only requires deleting:

```text
~/.cc-use/providers/<profile>.json
```

However, a real CLI command needs to handle the surrounding state as well:

- `~/.cc-use/config.json` may still point at the removed profile as the configured default.
- `CC_USE_DEFAULT` may still point at the removed profile for the current process environment.
- `~/.cc-use/sessions/<profile>/` may contain isolated session history.

## Goals

- Add a clear, memorable command for removing a profile config.
- Avoid leaving `config.json` with a broken default pointer.
- Preserve isolated session history by default.
- Provide an explicit option for deleting isolated session history.
- Improve `cc-use` no-arg startup when the default profile is missing or unset.
- Keep the launcher boundary intact: do not modify native `~/.claude/`.

## Non-goals

- Do not add bulk removal in the first version.
- Do not remove native Claude Code history under `~/.claude/`.
- Do not mutate the user's shell rc files or parent shell environment.
- Do not introduce runtime dependencies.
- Do not change the meaning of `cc-use <profile>`, `cc-use with <profile>`, or `cc-use isolate <profile>`.

## Command design

Add:

```bash
cc-use remove <profile>
cc-use remove <profile> --yes
cc-use remove <profile> --delete-session
cc-use remove <profile> --yes --delete-session
```

### Default behavior

`cc-use remove <profile>` removes only:

```text
~/.cc-use/providers/<profile>.json
```

It keeps:

```text
~/.cc-use/sessions/<profile>/
```

The session directory is user data. Keeping it by default is safer and makes the command easy to explain:

- remove = remove profile config
- `--delete-session` = also delete isolated session history

### Confirmation behavior

TTY:

- Ask for confirmation before deleting.
- If the user declines, return non-zero and do not delete anything.

Non-TTY:

- Require `--yes`.
- Without `--yes`, fail with a clear message.

This keeps CI/script usage explicit.

## Default handling

There are two default sources:

1. Configured default in `~/.cc-use/config.json`.
2. Runtime override from `CC_USE_DEFAULT`.

Existing `getDefaultProfile()` resolves the runtime-effective default and lets `CC_USE_DEFAULT` override `config.json`. Removal needs to distinguish those two sources.

Add a config-only read helper:

```ts
export function getConfiguredDefaultProfile(): string | undefined
```

Keep:

```ts
export function getDefaultProfile(): string | undefined
```

Semantics:

- `getDefaultProfile()` returns the effective default, including `CC_USE_DEFAULT`.
- `getConfiguredDefaultProfile()` reads only `config.json`.

When removing a profile:

- If `getConfiguredDefaultProfile() === profile`, call `setDefaultProfile(undefined)`.
- If `process.env.CC_USE_DEFAULT === profile`, print a warning. The CLI cannot modify the parent shell environment.

## No-arg startup recovery

Improve `cc-use` no-arg behavior.

### Current rough behavior

- No default: enter `init`.
- Broken default: print an error.

### Proposed behavior

When running:

```bash
cc-use
```

If no effective default exists:

- Non-TTY: fail and suggest `cc-use default <profile>` or `cc-use init`.
- TTY and at least one existing profile: show a picker, set the chosen profile as default, then launch it.
- TTY and no profiles: keep the current first-run `init` flow.

If the effective default points to a missing profile:

- Non-TTY: fail with a clear message.
- TTY and the missing default came from `config.json`: unset it, show the picker if profiles exist, otherwise enter `init`.
- TTY and the missing default came from `CC_USE_DEFAULT`: warn that the env override is stale, show the picker for this run, and tell the user to update or unset the environment variable.

Picker options:

- one entry per existing profile
- one final entry: `Create a new profile`

Selecting an existing profile:

- calls `setDefaultProfile(selected)`
- launches the selected profile using the existing default launch behavior

Selecting `Create a new profile`:

- runs `runInit({})`

## Implementation plan

### 1. Add remove execution module

Create:

```text
src/remove.ts
```

Suggested API:

```ts
export interface RemoveOptions {
  profile: string;
  yes: boolean;
  deleteSession: boolean;
}

export async function runRemove(opts: RemoveOptions): Promise<number>
```

Responsibilities:

- validate profile name
- ensure profile exists
- confirm deletion when needed
- delete `profilePath(profile)`
- unset configured default if it matches
- warn when `CC_USE_DEFAULT` still points at the removed profile
- optionally delete `sessionDirFor(profile)` when `deleteSession` is true
- print concise success messages

### 2. Add CLI parsing

Update:

```text
src/cli.ts
```

Add:

```text
case 'remove'
```

Add parser:

```ts
function parseRemoveArgs(args: string[]): {
  profile: string;
  yes: boolean;
  deleteSession: boolean;
}
```

Supported flags:

- `--yes`
- `-y`
- `--delete-session`

Unknown flags should fail with:

```text
cc-use remove: unknown flag '<flag>'
```

Missing profile should fail with:

```text
cc-use remove: profile name required.
```

### 3. Split configured default from effective default

Update:

```text
src/config.ts
```

Add `getConfiguredDefaultProfile()`.

Keep `getDefaultProfile()` as the public effective-default helper.

### 4. Reserve the command name

Update:

```text
src/profile.ts
```

Add `remove` to `RESERVED_NAMES`.

### 5. Improve no-default startup

Update:

```text
src/cli.ts
```

Refactor `launchWithDefault()` so that missing/default-broken states go through a helper such as:

```ts
async function chooseDefaultOrInit(passThroughArgs: string[]): Promise<void>
```

Use the existing `pickOption()` from `src/wizard.ts`.

The picker should be TTY-only. Non-TTY paths should fail with actionable text.

### 6. Update user-facing docs

Update:

```text
src/help.ts
README.md
README.zh-CN.md
docs/governance.md
```

Help line:

```text
cc-use remove <profile>             Remove a profile config (--delete-session removes isolated history)
```

README examples:

```bash
cc-use remove deepseek              # remove the profile config, keep isolated session history
cc-use remove deepseek --delete-session
```

Governance reserved names should include `remove`.

## Acceptance criteria

| ID | Scenario | Expected result |
|---|---|---|
| AC-RM-1 | `cc-use remove` | exits non-zero and says profile name is required |
| AC-RM-2 | `cc-use remove unknown --yes` | exits non-zero and says profile not found |
| AC-RM-3 | `cc-use remove deepseek --yes` | deletes `providers/deepseek.json` |
| AC-RM-4 | remove without `--delete-session` | keeps `sessions/deepseek/` if it exists |
| AC-RM-5 | remove with `--delete-session` | deletes `sessions/deepseek/` |
| AC-RM-6 | removing configured default | unsets default in `config.json` |
| AC-RM-7 | removing non-default profile | leaves configured default unchanged |
| AC-RM-8 | `CC_USE_DEFAULT` points at removed profile | prints a warning and does not attempt to mutate shell env |
| AC-RM-9 | `remove` as a profile name | rejected as a reserved subcommand |
| AC-RM-10 | no default but profiles exist, TTY | picker lets user choose a profile or create a new one |
| AC-RM-11 | configured default is missing, TTY | config default is unset and picker is shown |
| AC-RM-12 | effective default from `CC_USE_DEFAULT` is missing, TTY | warning is printed and picker is shown |
| AC-RM-13 | default missing in non-TTY | exits non-zero with actionable guidance |

## Test plan

Add or extend CLI tests around built `dist/cli.js`.

Suggested coverage:

- missing profile argument
- unknown profile
- successful removal
- default unset on removal
- session kept by default
- session deleted with `--delete-session`
- `CC_USE_DEFAULT` warning path
- reserved-name assertion for `remove`
- help text includes remove command
- non-TTY confirmation requirement
- no-default / broken-default startup behavior

Run:

```bash
pnpm build
pnpm test
```

Optional smoke tests:

```bash
node dist/cli.js ls
node dist/cli.js remove deepseek --yes
node dist/cli.js remove qwen --yes --delete-session
node dist/cli.js default
node dist/cli.js
```

## Notes for implementers

- Use `fs.rmSync(path, { recursive: true, force: true })` only for `sessions/<profile>/`.
- Use `unlinkSync(profilePath(profile))` for the profile JSON after `profileExists(profile)` passes.
- Keep output concise and script-friendly.
- Do not delete or inspect `~/.claude/`.
- Do not add dependencies.
