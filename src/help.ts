export const USAGE = `cc-use — launch Claude Code with a chosen Anthropic-compatible provider

Usage:
  cc-use                              Launch with the default profile (or wizard if none)
  cc-use <profile> [claude args...]   Launch using <profile>; extra args pass to claude
  cc-use [-flag args...]              Launch with default + pass args to claude
  cc-use init [template]              Interactive setup; defaults to picker
  cc-use ls                           List configured profiles
  cc-use doctor [profile]             Validate fields + probe endpoint (--all checks every profile, --no-probe skips network)
  cc-use default [profile]            Show or set the default profile
  cc-use import-history [profile]     Copy native Claude history into a profile
  cc-use --version | -v               Print version
  cc-use --help    | -h               Show this help

Built-in templates:
  deepseek, volcengine-plan, byteplus-plan, kimi, kimi-plan, glm, glm-intl, qwen, qwen-plan, qwen-intl, minimax, minimax-intl, openrouter, custom

Files (under ~/.cc-use/):
  providers/<name>.json   Your provider configurations
  config.json             { "default": "<profile>" }
  sessions/<name>/        Per-profile CLAUDE_CONFIG_DIR (sessions, never touches ~/.claude/)

cc-use never writes ~/.claude/, never edits your shell rc files.
Native \`claude\` (your official subscription) keeps working in parallel.

More: https://github.com/leechen298/cc-use
`;
