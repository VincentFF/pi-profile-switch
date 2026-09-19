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

profile 定义在两个 JSON 文件中，均可选：

| 文件 | 作用域 |
| --- | --- |
| `~/.pi-profile-switch/profiles.json` | 全局，对所有项目生效。`PI_PROFILE_SWITCH_DIR` 可自定义根目录；`~/.pi/agent/profiles.json` 作为遗留路径向下兼容，用于迁移。 |
| `<项目>/.pi/profiles.json` | 项目级，仅对已信任项目生效。 |

直接编辑 JSON 即可创建或修改 profile——schema 见 [`schemas/profiles.schema.json`](schemas/profiles.schema.json)。

安装时，pi-profile-switch 会向全局文件播种一个初始 **`ask`** profile——只读的问答与代码走读模式。它不假设你安装过任何插件，可随意修改或删除：

```json
{
  "schemaVersion": 1,
  "profiles": {
    "ask": {
      "label": "Ask & Discuss",
      "description": "Read-only Q&A and code exploration; no file modifications or command execution",
      "skills": [],
      "extensions": [],
      "tools": ["read", "grep", "find", "ls"],
      "instructions": "You are in read-only discussion mode. Answer questions and explain code without modifying any files or running shell commands."
    }
  }
}
```

一个 profile 可以同时使用全部字段。下面这个 `impl` profile 加载 TDD skill 和你的内部 skills、MCP adapter、两个 MCP server、显式 tool 白名单、钉住的模型，以及常驻 instructions：

```json
{
  "schemaVersion": 1,
  "profiles": {
    "impl": {
      "label": "Implementation",
      "description": "Full-powered implementation profile: every available field, pinned model",
      "skills": [
        "tdd",
        "internal-*"
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
        "write"
      ],
      "defaultProvider": "anthropic",
      "defaultModel": "claude-sonnet-4-5",
      "defaultThinkingLevel": "high",
      "instructions": "Prefer small, verifiable changes. Run the test suite before claiming completion."
    }
  }
}
```

字段解析规则：

- `skills`、`extensions`、`mcps`、`tools` 接受名称或 glob（如 `"internal-*"`），引用你已安装或已配置的资源——profile 从不复制资源。已安装的包和标准目录下的文件会被自动发现，无需注册。
- `tools` 针对 Pi 的实时工具注册表展开，因此接受内建工具、extension 提供的工具，以及 MCP server 暴露的工具。
- `mcps` 引用 pi-mcp-adapter 配置中的 server；连接细节留在 adapter 自己的配置里。
- 未写的字段保持原生 Pi 行为。

[`examples/`](examples/) 中的两个文件与上面一一对应：`profiles.json` 是播种的初始 profile，`example.json` 是全字段演示。

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

## 保证

- **引用而非复制**——profile 指向你自己拥有和维护的资源。
- **Pi 原生**——profile 未显式控制的一切保持原生 Pi 行为。
- **失败安全**——未信任的项目目录从不读取；切换失败回滚到上一份可用配置。

## 文档

- [架构设计](docs/architecture/overview.md) · [ADR](docs/adr/) · [术语表](CONTEXT.md)
- JSON Schema：[`schemas/`](schemas/)

## 许可证

MIT
