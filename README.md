# cc-use

[![npm version](https://img.shields.io/npm/v/cc-use.svg)](https://www.npmjs.com/package/cc-use)

Launch Claude Code with a third-party Anthropic-compatible provider, without touching your `~/.claude/`.

![cc-use demo](docs/assets/demo.gif)

## Install

```bash
npm install -g cc-use
```

Requires Node ≥ 18 and Claude Code (`npm install -g @anthropic-ai/claude-code`).

## Usage

```bash
cc-use init                       # interactive setup: pick template, paste API key
cc-use deepseek                   # launch Claude Code via DeepSeek (auto-init if not configured)
cc-use deepseek -p "review X"     # one-shot query (extra args pass through to claude)
cc-use                            # launch with the default profile

cc-use ls                         # list configured profiles
cc-use default [profile]          # show or set the default profile
cc-use doctor [profile]           # validate profile (--all checks all)
cc-use import-history [profile]   # copy current project's ~/.claude/ history into profile
cc-use --help                     # full command reference
```

`[profile]` is optional — omit to use the default profile.

Profile configs live in `~/.cc-use/providers/<name>.json` (chmod 600). Each profile uses an isolated `CLAUDE_CONFIG_DIR=~/.cc-use/sessions/<name>/`, so `~/.claude/` is never read or modified.

## Built-in providers

| Template      | Provider                          | Endpoint                                      |
|---------------|-----------------------------------|-----------------------------------------------|
| `deepseek`    | DeepSeek V4 (direct)              | `api.deepseek.com/anthropic`                  |
| `kimi`        | Moonshot Kimi K2.6 (direct, CN)   | `api.moonshot.cn/anthropic`                   |
| `kimi-plan`   | Moonshot Kimi Coding Plan         | `api.kimi.com/coding/`                        |
| `glm`         | Zhipu GLM 5.1 (CN)                | `open.bigmodel.cn/api/anthropic`              |
| `glm-intl`    | Zhipu GLM 5.1 (international)     | `api.z.ai/api/anthropic`                      |
| `qwen`        | Aliyun DashScope Qwen (direct, CN)| `dashscope.aliyuncs.com/apps/anthropic`       |
| `qwen-plan`   | Aliyun Bailian Token Plan (CN)    | `token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic` |
| `qwen-intl`   | Aliyun Model Studio (international)| `dashscope-intl.aliyuncs.com/apps/anthropic`  |
| `minimax`     | MiniMax M2.7 (CN)                 | `api.minimaxi.com/anthropic`                  |
| `minimax-intl`| MiniMax M2.7 (international)      | `api.minimax.io/anthropic`                    |
| `volcengine-plan` | Volcengine ARK Coding Plan (CN) | `ark.cn-beijing.volces.com/api/coding`     |
| `volcengine-intl-plan` | BytePlus ModelArk Coding Plan (intl) | `ark.ap-southeast.bytepluses.com/api/coding` |
| `openrouter`  | OpenRouter                        | `openrouter.ai/api`                           |
| `custom`      | Bring your own                    | (you fill in)                                 |

The `-plan` variants point at the provider's subscription endpoint (Coding Plan / Token Plan) — usually the Anthropic-compatible path the provider explicitly documents for Claude Code, with subscription-flat billing instead of per-token.

Templates ship without API keys — set yours via `cc-use init`.

## Development

```bash
git clone https://github.com/leechen298/cc-use.git
cd cc-use
pnpm install        # npm/yarn also work; only pnpm-lock.yaml is committed
pnpm build
pnpm test
```

## License

MIT © leechen298
