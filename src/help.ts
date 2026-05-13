export const USAGE = `cc-use — launch Claude Code with a chosen Anthropic-compatible provider

Usage:
  cc-use                              Launch with the default profile (shared context; or wizard if none)
  cc-use <profile> [claude args...]   Launch using <profile> (shared context); extra args pass to claude
  cc-use auto [claude args...]        Auto-select a usable profile, then launch shared context
  cc-use with [profile] [claude args...]  Explicit shared-context launch (default profile if omitted)
  cc-use with auto [claude args...]   Compatibility alias for shared auto
  cc-use isolate [profile] [claude args...]  Explicit isolated launch (default profile if omitted)
  cc-use isolate auto [claude args...]  Auto-select a usable profile, then launch isolated
  cc-use [-flag args...]              Launch with default + pass args to claude
  cc-use init [template]              Interactive setup; defaults to picker
  cc-use ls                           List configured profiles
  cc-use status                       Show last known auto-routing usability status
  cc-use remove <profile>             Remove a profile config (--delete-session removes isolated history)
  cc-use doctor [profile]             Validate fields + probe endpoint (--all checks every profile, --no-probe skips network)
  cc-use default [profile]            Show or set the default profile
  cc-use import-history [profile]     Copy native Claude history into a profile (--sanitize enables provider-compatible cleanup)
  cc-use --version | -v               Print version
  cc-use --help    | -h               Show this help

Built-in templates:
  deepseek, volcengine-plan, byteplus-plan, kimi, kimi-plan, glm, glm-intl, qwen, qwen-plan, qwen-intl, minimax, minimax-intl, mimo, mimo-plan, openrouter, custom

Files (under ~/.cc-use/):
  providers/<name>.json   Your provider configurations
  config.json             { "default": "<profile>" }
  status.json             Last known auto-routing usability cache
  sessions/<name>/        Per-profile CLAUDE_CONFIG_DIR (isolated sessions)

By default, cc-use shares your native ~/.claude/ context (history, skills, projects).
Use cc-use isolate <profile> for a separate CLAUDE_CONFIG_DIR per profile.
cc-use never edits your shell rc files.
Native \`claude\` (your official subscription) keeps working in parallel.

More: https://github.com/leechen298/cc-use
`;
