# 02_design.md — cc-use v0.1 设计

> **Stage**: Innovate（设计选型 + 备选方案 + 决策依据）
> **依据**: 01_requirement.md v2（已 sign-off）
> **北极星约束**（用户原话）：
> > 直接用 `cc-use deepseek` 启动 Claude Code，并用 DeepSeek 开发，**完全不动 Claude Code 本身的配置**，**让用户两个可以同时跑**。守住这条线就可以。

本设计的三个关键决策点都围绕这条线展开。

---

## 设计点 A — 代码结构（多模块 vs 单文件）

| 方案 | 描述 | Pros | Cons |
|---|---|---|---|
| **A1（采纳）⭐ 多模块** | `src/{cli,paths,profile,exec,init,doctor,wizard}.ts` | TS 单元测试粒度细；社区 PR 审阅清晰；后续加子命令成本低 | 文件多一点 |
| A2 单文件 | 全部塞进 `src/cli.ts` | 看着简单 | 600+ 行后难维护；测试只能整体跑；模块边界靠注释 |

**选 A1**。理由：开源项目长期维护，模块化收益大于成本；零运行时依赖目标不变。

---

## 设计点 B — Profile 隔离机制（**北极星约束的核心**）

这是整个项目最关键的决策。三种隔离强度：

| 方案 | 实现 | "不动 ~/.claude/" | "同时跑互不干扰" | 评价 |
|---|---|---|---|---|
| B0 不隔离 | 只设 `ANTHROPIC_*`，不改 `CLAUDE_CONFIG_DIR` | ❌ Claude Code 仍写 `~/.claude/projects/<cwd-hash>/` | ⚠️ 同 cwd 不同 provider 会话历史会混 | **违反北极星，否决** |
| B1 共享 cc-use 目录 | 所有 profile 共用 `$DATA/cc-use/sessions/` | ✅ | ⚠️ profile 之间还是混 | 半解 |
| **B2（采纳）⭐ 每 profile 独立 dir** | 每次 spawn 设 `CLAUDE_CONFIG_DIR=$DATA/cc-use/sessions/<profile>` | ✅ | ✅ deepseek 和 kimi 两个终端并行，会话/上下文/资源各管各 | 完美对齐北极星 |

**采纳 B2**。具体路径：

| 平台 | 隔离目录 |
|---|---|
| macOS | `~/Library/Application Support/cc-use/sessions/<profile>/` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/cc-use/sessions/<profile>/` |
| Windows | `%LOCALAPPDATA%\cc-use\sessions\<profile>\` |

每个 profile 第一次跑时自动创建该目录，spawn 时把 `CLAUDE_CONFIG_DIR` 指过去。Claude Code 会把会话/projects/缓存全写进去，**`~/.claude/` 一字节不动**。

副作用说明（写进 README）：

- 每个 profile 是独立"工作区"，无法看到原生 Claude Code 的项目历史 —— 这是 feature 不是 bug，对应北极星
- `cc-use deepseek` 第一次跑 Claude Code 不会复用任何已有 session，需要从头开始（这正是用户要的"做代码审查"场景：要全新视角）

---

## 设计点 C — 交互向导实现（zero-dep 原则）

| 方案 | 实现 | Pros | Cons |
|---|---|---|---|
| **C1（采纳）⭐ 纯 node:readline** | Node 内置 `readline.createInterface` + `process.stdin.setRawMode` 自己实现 hidden input | 0 dep，直接命中 AC10；约 80 行 | 自己写要测细 |
| C2 引 `@inquirer/core` | 成熟交互库 | 体验好 | 增加依赖（运行时 ~10KB+），违反 AC10 |
| C3 引 `prompts` | 极小 prompt 库 | 体验中 | 同上 |

**采纳 C1**。Hidden input 实现：检测 `process.stdin.isTTY`：

- TTY 模式：`setRawMode(true)` → 手动 read byte → 显示 `*` 或不显示 → 回车结束
- 非 TTY（CI / 管道）：fallback 为明文 + stderr 警告"input not hidden"

---

## 设计点 D — Claude CLI 二进制定位（跨平台关键细节）

Spawn 时找 `claude` 可执行文件，**Windows 是 `claude.cmd`，Unix 是 `claude`**。两种方案：

| 方案 | 实现 | Pros | Cons |
|---|---|---|---|
| **D1（采纳）⭐ shell:true + PATH 解析** | `spawn('claude', args, {shell: process.platform === 'win32', env, stdio: 'inherit'})` | Windows 自动找 `claude.cmd`；Unix 直接走 PATH | shell:true 在 Win 上有 arg 转义风险（用 args array 让 Node 处理） |
| D2 显式 which/where | 启动前先 `which claude` / `where claude.cmd` | 路径明确 | 多一次 IO；硬编码扩展名 |

**采纳 D1**。Node 18+ 的 `child_process.spawn` 在 Windows 走 `shell:true` 会正确处理 `.cmd` 包装，arg 用数组形式传，转义由 Node 接管。

---

## 设计点 E — 探活请求格式（doctor 命令）

发最小请求验证端点是 Anthropic Messages 协议：

```
POST <ANTHROPIC_BASE_URL>/v1/messages
Headers:
  x-api-key: <ANTHROPIC_AUTH_TOKEN>
  anthropic-version: 2023-06-01
  content-type: application/json
Body:
  {"model": <ANTHROPIC_MODEL>, "max_tokens": 1, "messages": [{"role":"user","content":"ping"}]}
```

判定矩阵：

| HTTP 状态 | Body 形态 | 判定 |
|---|---|---|
| 200 | `{type:"message", content:[...], ...}` | ✅ Healthy |
| 401 / 403 | `{type:"error", error:{type:"authentication_error"}}` | ⚠️ 端点对，但 Key 错（提示用户重新 init） |
| 200 / 4xx | HTML / 非 Anthropic JSON | ❌ 不是 Anthropic 协议（提示用户检查 base_url） |
| 404 | 任何 | ❌ 端点错 |
| 网络错 | — | ❌ 网络问题 |

`--no-probe` 跳过此请求，只做字段校验。

---

## 设计点 F — argv 解析（含 default profile）

```
cc-use                          → 有默认: spawn(default); 无默认: 进 wizard
cc-use --version / -v           → 打印版本
cc-use --help / -h              → 打印帮助
cc-use <reserved-subcommand> …  → 子命令: init/ls/doctor/default/import-history/with/isolate
cc-use <profile-name> [args...] → spawn(profile, isolated) + 透传 args 给 claude (等价于 isolate)
cc-use -<...> [args...]         → 首参以 `-` 开头视为 claude args，用默认 profile 透传
cc-use -- [args...]             → 强制用默认 profile + 透传（极少用，规避歧义）
cc-use <unknown-name> [args...] → 报错: "no such profile"，提示 cc-use ls
```

保留子命令名（不可作为 profile 名）：`init / ls / doctor / default / help / version / import-history / with / isolate`。

默认 profile 存储：`<config-dir>/config.json` 的 `{"default": "<profile-name>"}` 字段。读优先于环境变量 `CC_USE_DEFAULT`（高级用户可在脚本中临时覆盖）。

## 决策汇总

| 设计点 | 选择 |
|---|---|
| A 代码结构 | 多模块 `src/*.ts` |
| B Profile 隔离 | 每 profile 独立 `CLAUDE_CONFIG_DIR` |
| C 交互向导 | 纯 `node:readline` |
| D Claude 定位 | `spawn` + `shell:process.platform==='win32'` |
| E 探活 | Messages API ping，1 token，状态码 + body shape 双重判定 |
| F argv 解析 | 子命令优先；profile 匹配次之；`-` 开头/`--` 走默认 + 透传；未知名字报错 |

---

## 模块边界（指导 03_implementation.md 的拆分）

```
src/
├── cli.ts              # 入口：argv 分发到子命令；--version/--help
├── paths.ts            # 解析 profile 目录 + 隔离目录（跨平台）
├── profile.ts          # 读 / 校验 / 列出 profile JSON（核心校验逻辑）
├── exec.ts             # spawn claude + 信号转发 + 退出码透传 + CLAUDE_CONFIG_DIR 注入
├── init.ts             # init 子命令：复制内置模板 → 调 wizard
├── wizard.ts           # 交互向导：hidden input、TTY 检测、模板默认值
├── doctor.ts           # doctor 子命令：字段校验 + 端点探活
└── ls.ts               # ls 子命令
templates/              # 7 个内置 provider JSON
test/                   # node:test 单元测试
```

---

## Sign-off Stage 2

- [ ] 用户确认决策汇总（A / B / C / D / E）—— 想推翻哪条直接说
- [ ] 进入 Stage 3 Plan，产出 03_implementation.md（每步 ≤ 30min 可独立验证）
