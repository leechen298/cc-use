# cc-use

[![npm version](https://img.shields.io/npm/v/cc-use.svg)](https://www.npmjs.com/package/cc-use)

Launch Claude Code with a third-party Anthropic-compatible provider, without touching your `~/.claude/`.

## Install

```bash
npm install -g cc-use
```

Requires Node ≥ 18 and Claude Code (`npm install -g @anthropic-ai/claude-code`).

## Usage

```bash
cc-use init                # interactive setup: pick template, paste API key
cc-use deepseek            # launch Claude Code via DeepSeek
cc-use kimi -p "review X"  # one-shot query

cc-use ls                  # list profiles
cc-use doctor              # validate default profile
cc-use --help              # all commands
```

Profile configs live in `~/.cc-use/providers/<name>.json` (chmod 600). Each profile uses an isolated `CLAUDE_CONFIG_DIR=~/.cc-use/sessions/<name>/`, so `~/.claude/` is never read or modified.

## Built-in providers

| Template      | Provider                    | Endpoint                                      |
|---------------|-----------------------------|-----------------------------------------------|
| `deepseek`    | DeepSeek V4                 | `api.deepseek.com/anthropic`                  |
| `volcengine`  | Volcengine ARK (Doubao)     | `ark.cn-beijing.volces.com/api/coding`        |
| `kimi`        | Moonshot Kimi K2            | `api.moonshot.ai/anthropic`                   |
| `glm`         | Zhipu GLM 4.6+              | `open.bigmodel.cn/api/anthropic`              |
| `qwen`        | Alibaba DashScope (Bailian) | `dashscope.aliyuncs.com/apps/anthropic`       |
| `openrouter`  | OpenRouter                  | `openrouter.ai/api`                           |
| `custom`      | Bring your own              | (you fill in)                                 |

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
