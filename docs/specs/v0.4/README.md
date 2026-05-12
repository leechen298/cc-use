# cc-use v0.4 Spec Overview

> This document describes the proposed `v0.4` feature line for automatic profile routing.  
> It is a maintainers' technical design summary, not a release note.

## Positioning

`v0.4` adds **preflight automatic profile selection** on top of the existing `v0.3` launch model.

The routing unit is intentionally **profile**, not provider and not model.

That is the correct abstraction for `cc-use` because the launcher already operates on:

- a named profile under `~/.cc-use/providers/<name>.json`
- a computed child env built from that profile
- a target `CLAUDE_CONFIG_DIR` selected by launch mode

This phase should be understood as:

**shared-context and isolated launch modes + automatic preflight routing for usable profiles**

## Product boundary

`v0.4` does **not** try to become a billing system, quota dashboard, or mid-run failover layer.

The feature boundary is intentionally narrow:

- check candidate profiles before a task starts
- select the first usable profile according to routing policy
- launch Claude Code with that profile
- optionally persist the last known check result

Out of scope for this phase:

- provider/model quality scoring
- task-type-aware routing
- remaining plan quota estimation for token-plan products
- mid-run automatic switching after a provider fails
- retry orchestration across providers
- CRUD commands for editing auto-routing config

## CLI semantics

### `cc-use auto`

Automatic isolated launch.

- resolves the candidate profile list
- checks usability for each candidate in order
- launches the first usable profile in isolated mode
- uses `~/.cc-use/sessions/<selected-profile>/` as `CLAUDE_CONFIG_DIR`

### `cc-use with auto`

Automatic shared-context launch.

- resolves the same candidate profile list
- checks usability for each candidate in order
- launches the first usable profile in shared mode
- uses native `~/.claude/` as `CLAUDE_CONFIG_DIR`

### `cc-use status`

Usability snapshot view.

- prints last known status for auto-participating profiles
- shows whether a status entry is fresh or stale according to cache TTL
- does not silently mutate routing config

### Existing commands stay unchanged

`v0.4` must not change the semantics of:

- `cc-use <profile>`
- `cc-use with <profile>`
- `cc-use isolate <profile>`
- `cc-use default [profile]`

`auto` is an additional routing path, not a replacement for explicit profile launch.

## Core abstraction

The design center of `v0.4` is:

> checker can be complex, status can be detailed, router must stay dumb

The system is split into two layers:

### 1. Checker

The checker understands provider-specific and mode-specific rules:

- pay-as-you-go balance checks
- pay-as-you-go probe fallback checks
- token-plan probe checks
- manual availability declarations
- cache reuse rules
- error normalization

Its output is a normalized result object.

### 2. Router

The router does not understand billing, quota, or HTTP details.

It only iterates through candidates and picks the first result where:

```ts
result.usable === true
```

The router must never infer usability from `reason`.

## Normalized result model

```ts
type UsabilityReason =
  | 'balance_ok'
  | 'balance_below_threshold'
  | 'probe_ok'
  | 'probe_failed'
  | 'manual_available'
  | 'manual_unavailable'
  | 'check_failed'
  | 'unknown';

type UsabilityResult = {
  profileName: string;
  usable: boolean;
  reason: UsabilityReason;
  checkedAt: string;
  details?: {
    balance?: number;
    currency?: string;
    minBalance?: number;
    httpStatus?: number;
    errorType?: string;
    errorMessage?: string;
    adapter?: string;
  };
};
```

Key rules:

- `usable` is the final routing decision for one profile
- `reason` explains why the decision was reached
- `details` is optional diagnostic context only
- `details` must stay redacted and must not store raw API responses, keys, or account-identifying payloads

## Usability semantics by profile mode

### Pay-as-you-go profiles

Pay-as-you-go profiles prefer balance availability when a stable provider balance API exists.

When no stable balance API exists, pay-as-you-go profiles may fall back to the same minimal probe mechanism used by token-plan profiles. In that case, `cc-use` does not know the remaining balance; it only knows whether the current model endpoint recently accepted a minimal request.

Supported check types:

- `api`
- `probe`

Interpretation:

- `balance >= minBalance` -> `usable: true`, `reason: 'balance_ok'`
- `balance < minBalance` -> `usable: false`, `reason: 'balance_below_threshold'`
- minimal probe succeeds -> `usable: true`, `reason: 'probe_ok'`
- probe reaches the provider and returns a disqualifying result -> `usable: false`, `reason: 'probe_failed'`
- check execution failed -> `usable: false`, `reason: 'check_failed'`
- no check configured -> `usable: false`, `reason: 'unknown'`

Only pay-as-you-go profiles participate in balance recording for this phase.

Balance API adapters are explicit, per-provider capabilities. `cc-use` must not assume every pay-as-you-go provider exposes a usable balance API, and it must not scrape provider consoles or call undocumented billing endpoints.

For pay-as-you-go profiles without a balance adapter, probe-based usability is the recommended default. A recent successful probe can be reused within cache TTL as last-known usability. If the cached status is unavailable, stale, or missing, `cc-use auto` should silently run a fresh minimal probe before skipping the profile.

### Token-plan profiles

Token-plan profiles are **not** judged by remaining quota estimation.

`v0.4` does not attempt to infer:

- remaining package credits
- subscription days left
- future long-task success probability

Instead, a token-plan profile is considered usable only if it can complete a minimal live request right now.

Supported check types:

- `probe`
- `manual_availability`

Interpretation:

- minimal probe succeeds -> `usable: true`, `reason: 'probe_ok'`
- probe reaches the provider and returns a disqualifying result -> `usable: false`, `reason: 'probe_failed'`
- probe execution itself fails -> `usable: false`, `reason: 'check_failed'`
- no check configured -> `usable: false`, `reason: 'unknown'`

This means:

> token-plan usable means eligible for routing at task start, not guaranteed to finish a long session

### Manual checks

Manual checks exist for profiles where the user does not want live checks or where no stable API integration exists yet.

Supported manual forms:

- manual availability boolean

`v0.4` deliberately allows manual participation without adding config-edit subcommands.

## Probe semantics

The `probe` check must be explicitly documented as:

> a minimal live Anthropic-compatible request used to determine whether the profile is currently usable

It is not:

- a balance check
- a quota inspection API
- a guarantee that a long Claude Code session will succeed

Implementation guidance:

- reuse the existing minimal Messages API probe path already used by `doctor`
- keep the request intentionally small
- classify result categories consistently

Recommended boundary:

- `probe_failed`: request reached a valid endpoint and returned a usable "no" answer such as auth failure, quota/rate-limit failure, unsupported model, or Anthropic-style error
- `check_failed`: the checking workflow itself failed, such as timeout, DNS/network failure, invalid JSON, or adapter failure

Provider-side incidents are expected and should be normalized into these same results:

- explicit API rejection -> `probe_failed`
- provider outage, gateway error, malformed response, or network failure -> `check_failed`

This keeps the router stable even when a supplier fails in a way that is not clearly reported as insufficient balance.

## Candidate ordering

The candidate order is:

1. configured default profile first
2. `fallbackOrder` entries after removing duplicates

Unknown profiles are skipped by default because:

- the router must be conservative
- `v0.4` should not guess that an unchecked profile might be usable

No optimistic "try anyway" behavior is part of the default flow in this phase.

## Configuration model

Profile env files remain unchanged:

- `~/.cc-use/providers/<name>.json` stays an env-focused profile file
- auto-routing metadata must not be mixed into provider env payloads

`v0.4` extends `~/.cc-use/config.json` with an `auto` block:

```json
{
  "default": "deepseek",
  "auto": {
    "cacheTtlSeconds": 60,
    "fallbackOrder": ["deepseek", "kimi", "mimo-plan"],
    "profiles": {
      "deepseek": {
        "mode": "payg",
        "minBalance": 1,
        "check": { "kind": "api", "adapter": "deepseek" },
        "recordUsage": true
      },
      "kimi": {
        "mode": "payg",
        "check": { "kind": "probe" }
      },
      "mimo-plan": {
        "mode": "token_plan",
        "check": { "kind": "probe" }
      },
      "glm-plan": {
        "mode": "token_plan",
        "check": { "kind": "manual_availability", "available": true }
      }
    }
  }
}
```

This preserves the existing contract that profile files represent env injection inputs, while routing metadata lives in the global config domain.

## Status cache model

`v0.4` adds a status cache file under `~/.cc-use/`.

Suggested filename:

- `status.json`

This file is a cache, not a source of truth.

It stores the last known usability result for each auto-participating profile.

Responsibilities:

- improve `cc-use status`
- avoid unnecessary repeated checks within TTL
- preserve recent diagnostics for debugging

Non-responsibilities:

- it must not override config
- it must not be treated as durable truth
- it must not silently make unknown profiles routable

Cache behavior:

- no cache -> run live check
- stale cache -> run live check
- fresh cache -> may reuse
- fresh successful probe cache -> may be treated as currently usable
- unavailable cache -> run a fresh minimal probe before skipping the profile
- live check fails -> write `usable: false` with `reason: 'check_failed'`

## Optional usage snapshots for pay-as-you-go

This phase may optionally record before/after balance snapshots for supported pay-as-you-go profiles.

The MVP implementation may parse `recordUsage` for forward compatibility without producing a usage ledger until at least one stable balance adapter exists.

The behavior is intentionally narrow:

- before launch, read balance if `recordUsage` is enabled and the profile uses a supported balance adapter
- after the child process exits, read balance again
- persist a best-effort delta if both snapshots succeed

This is not a prerequisite for routing.

Routing must work even if usage recording is disabled or unavailable.

## Launch invariants

`v0.4` must preserve existing launcher invariants:

- `cc-use` remains a launcher, not a proxy
- native `~/.claude/` is only reused through the explicit shared-context path
- isolated launch still uses `~/.cc-use/sessions/<profile>/`
- no command in this phase writes back into native Claude Code state

Auto-routing chooses **which profile to launch**.
It does not change **how the selected mode launches**.

## Suggested module boundaries

Recommended additions:

```text
src/
├── auto.ts        # candidate resolution + routing orchestration
├── status.ts      # status cache read/write + CLI rendering
├── balance.ts     # payg balance adapters
```

Recommended refactor:

- extract a reusable probe helper from `doctor.ts`
- keep `exec.ts` focused on launching only
- keep `cli.ts` responsible for command dispatch, not routing rules

## Test focus

Minimum behavioral coverage for this phase:

- `cc-use auto` picks default when default is usable
- `cc-use auto` falls back when default is not usable
- `cc-use with auto` still launches with native `~/.claude/`
- unknown profiles are skipped
- stale cache triggers a live re-check
- `check_failed` is persisted as unusable
- router uses only `usable`, never `reason`
- `status` output distinguishes usable state from diagnostic reason

## Non-goals

`v0.4` still does not introduce:

- automatic model selection inside one profile
- routing by task difficulty or task category
- background status daemons
- provider-specific web scraping for billing consoles
- automatic recovery after a provider runs out of money mid-session
- a promise that token-plan probe success implies long-session success

The focus of this phase is:

**preflight routing to the first usable profile while preserving the existing launcher model**
