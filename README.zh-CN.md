# pi-profile-switch

[English](README.md) | [中文](README.zh-CN.md)

[Pi](https://github.com/badlogic/pi-mono) 的命名 profile 扩展。一个 profile 是你自定义的命名能力组合：skills、extensions、MCP server、tools（包括 MCP server 和 extension 提供的工具）、默认模型，以及追加到系统提示词的 instructions。在同一个运行中的 Pi 会话里切换这些组合，无需重启。

## 安装

```bash
npm install -g pi-profile-switch
```

依赖 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)（作为 peer dependency 自动安装）。

## 快速上手

```bash
# 使用内建 default profile 启动（全量资源，等同原生 Pi）
pi-profile

# 使用安装时播种的只读 ask profile 启动
pi-profile ask

# -- 后面的参数原样传给 pi
pi-profile ask -- --model openai/gpt-5.4
```

## 自定义 profile

profile 保存在两个目录中，每个 profile 对应一个独立 JSON 文件：

| 路径 | 作用域 |
| --- | --- |
| `~/.pi-profile-switch/profiles/<name>.json` | 全局，对所有项目生效。`PI_PROFILE_SWITCH_DIR` 可自定义根目录。 |
| `<项目>/.pi/profiles/<name>.json` | 项目级，仅对已信任项目生效。 |

直接编辑或新建 `<name>.json` 即可创建或修改 profile——schema 见 [`schemas/profiles.schema.json`](schemas/profiles.schema.json)。

你也可以通过对话让 agent 帮你配置：随包附带的 **`profile-config`** skill（安装时分发至 `<agentDir>/skills/profile-config/`）会指导 agent 澄清需求、发现资源并读写 profile 文件。按约定，生成声明了 `skills` 的 profile 时默认包含 `"profile-config"`（除非明确排除或已被 `*` 等 glob 覆盖），确保切换到新 profile 后仍可持续对话配置。详情见 [`skills/profile-config/SKILL.md`](skills/profile-config/SKILL.md)。

安装时，pi-profile-switch 会向全局 `profiles/` 目录播种一个初始 **`ask`** profile（`ask.json`）——只读的问答与代码走读模式。它不假设你安装过任何插件，可随意修改或删除：

```json
{
  "label": "Ask & Discuss",
  "description": "Read-only Q&A and code exploration; no file modifications or command execution",
  "skills": [],
  "extensions": [],
  "tools": ["read", "grep", "find", "ls"],
  "instructions": "You are in read-only discussion mode. Answer questions and explain code without modifying any files or running shell commands."
}
```

一个 profile 可以同时使用全部字段。下面这个 `impl` profile 示例（`impl.json`）加载 TDD skill、mcp-scripting skill（pi-mcp-adapter 自带）和你的内部 skills；接入两个 MCP server；tool 白名单用 glob 覆盖内建工具和这两个 server 的 MCP 工具；并钉住模型与常驻 instructions：

```json
{
  "label": "Implementation",
  "description": "Full-powered implementation profile: every available field, pinned model",
  "skills": [
    "tdd",
    "internal-*",
    "mcp-scripting"
  ],
  "extensions": [
    "pi-mcp-adapter"
  ],
  "mcps": [
    "github",
    "linear"
  ],
  "tools": [
    "read",
    "grep",
    "find",
    "ls",
    "bash",
    "edit",
    "write",
    "mcp__*",
    "github_*",
    "linear_*"
  ],
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5",
  "defaultThinkingLevel": "high",
  "instructions": "Prefer small, verifiable changes. Run the test suite before claiming completion."
}
```

字段解析规则：

- `skills`、`extensions`、`mcps`、`tools` 接受名称或 glob（如 `"internal-*"`），引用你已安装或已配置的资源——profile 从不复制资源。已安装的包和标准目录下的文件会被自动发现，无需注册。
- `tools` 针对 Pi 的实时工具注册表展开——内建工具、extension 提供的工具，以及 MCP server 暴露的工具。MCP 工具注册为 `mcp__<server>`（代理）和 `<server>_<tool>`（直接工具，adapter 默认 `toolPrefix`），因此 `mcp__*`、`github_*` 这类 glob 可以覆盖它们。
- `mcps` 引用 pi-mcp-adapter 配置中的 server；连接细节留在 adapter 自己的配置里。
- 未写的字段保持原生 Pi 行为。

[`examples/`](examples/) 中的两个文件与上面一一对应：`ask.json` 是播种的初始 profile，`example.json` 是全字段演示。

### 从旧版本迁移

如果你之前使用了把全部 profile 存在单个 `profiles.json`（含 `schemaVersion: 1`）的旧版本，请手动把每个 profile 拆分到 `profiles/` 目录：

1. 创建 `~/.pi-profile-switch/profiles/`（或 `<项目>/.pi/profiles/`）目录。
2. 将旧 `profiles.json` 中 `profiles` 下的每个 `<name>` 键值提取为独立的 `<name>.json` 文件。
3. 去除外层的 `schemaVersion` 与 `profiles` 信封，文件顶层即为裸 profile 定义。

## 命令

在 TUI 中，`/profile` 命令族完成所有会话内操作：

| 命令 | 作用 |
| --- | --- |
| `/profile` | 交互式选择 profile |
| `/profile list` / `/profile status` | 列出 profile / 查看活动 profile 详情 |
| `/profile use <name>` / `/profile reload` | 会话内切换 / 重载（失败自动回滚） |
| `/profile create\|edit\|delete\|duplicate` | 向导式 profile 增删改（仅 TUI） |
| `/profile customize` / `/profile reset` | 仅本次会话收窄活动 profile |

非交互模式（`--mode rpc|print|json`）下命令同样生效；CRUD 向导仅 TUI 可用。

## 文档

- [架构设计](docs/architecture/overview.md) · [ADR](docs/adr/) · [术语表](CONTEXT.md)
- JSON Schema：[`schemas/`](schemas/)

## 许可证

MIT
