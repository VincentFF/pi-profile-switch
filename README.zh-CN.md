# pi-profile-switch

[English](README.md) | [中文](README.zh-CN.md)

[Pi](https://github.com/badlogic/pi-mono) 的命名 profile 扩展。一个 profile 是你自定义的命名能力组合：skills、extensions、MCP server、tools、按 server 细化的 MCP 工具控制（`mcp_tools`）、默认模型，以及追加到系统提示词的 instructions。在同一个运行中的 Pi 会话里切换这些组合，无需重启。

## 安装

```bash
npm install -g pi-profile-switch
```

需要 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 0.99.1 或更新版本（作为 peer dependency 自动安装）。请用 `npm install -g` 安装，而不是 `pi install`：本包提供的是 `pi-profile` 启动器。

## 快速上手

```bash
# 使用内建 default profile 启动（全量资源，等同原生 Pi）
pi-profile

# 使用初始的只读 ask profile 启动
pi-profile ask

# -- 后面的参数原样传给 pi
pi-profile ask -- --model openai/gpt-5.4
```

## 自定义 profile

profile 保存在两个目录中，每个 profile 对应一个 JSON 文件：

| 路径 | 作用域 |
| --- | --- |
| `~/.pi-profile-switch/profiles/<name>.json` | 全局，对所有项目生效。`PI_PROFILE_SWITCH_DIR` 可自定义根目录。 |
| `<项目>/.pi/profiles/<name>.json` | 项目级，仅对已信任项目生效；同名时会完全替换全局 profile。 |

直接写 JSON 文件即可（schema 见 [`schemas/profiles.schema.json`](schemas/profiles.schema.json)），也可以让 agent 帮你改：本包自带 [`profile-config`](skills/profile-config/SKILL.md) skill，能创建、修改和删除 profile。只要新建的 profile 声明了 `skills`，默认会包含 `"profile-config"`（除非你明确排除，或已被 `"*"` 之类的 glob 覆盖），这样切过去之后还能继续用对话调整。

全局 `profiles/` 目录里还没有 profile 时，pi-profile-switch 会写入一个初始 **`ask`** profile——只读问答与代码走读。它不假设你安装过任何插件，可随意修改或删除。见 [`examples/ask.json`](examples/ask.json)。

一个用到全部字段的 profile：

```json
{
  "label": "Implementation",
  "description": "Full-powered implementation profile: every available field, pinned model",
  "skills": ["tdd", "internal-*"],
  "mcps": ["github", "linear"],
  "tools": ["read", "grep", "find", "ls", "bash", "edit", "write"],
  "mcp_tools": {
    "github": ["search", "get_issue"],
    "linear": []
  },
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5",
  "defaultThinkingLevel": "high",
  "instructions": "Prefer small, verifiable changes. Run the test suite before claiming completion.",
  "subagents": {
    "defaultModel": "anthropic/claude-sonnet-4-5",
    "agentOverrides": {
      "reviewer": {
        "thinking": "high",
        "description": "本项目的独立代码审查",
        "advertise": true
      }
    }
  }
}
```

字段行为：

- `label`、`description` 仅用于显示。`defaultProvider` 与 `defaultModel` 需同时声明，用于指定启动模型；`defaultThinkingLevel` 指定思考等级；`instructions` 会追加到系统提示词。
- 可选的 `subagents` 字段可为原生 pi-subagents 设置模型、thinking 默认值和精确角色覆盖；它不会加载 pi-subagents，也不会改变可用角色或工具。角色 `description` 是元数据，不是子 agent prompt；`advertise` 控制是否列入父 prompt，不控制角色能否运行。`/profile status` 展示 profile 声明，`/subagents-models` 检查原生实时映射。详见[子 agent 行为契约](openspec/specs/launcher/spec.md)和[pi-subagents 模型文档](https://github.com/nicobailon/pi-subagents/blob/main/docs/models.md)。
- `skills`、`extensions`、`mcps`、`tools` 以名称或 glob 引用已安装的资源；profile 不会复制资源。`tools` 只涉及非 MCP 工具（内置工具和扩展工具）。
- `mcp_tools` 按字面 server 名和工具名选择 MCP 工具，不接受 glob。省略某个 server 表示保持原样，写 `[]` 表示禁用它的全部工具但保留 server 本身，列出名称表示只允许这些工具。字面选择器匹配不到内容时仍保持限制且不报错；server 未知、已禁用或只存在于项目级配置时，激活会失败并给出候选。
- `mcps` 列出用户级 server，可来自 `~/.config/mcp/mcp.json`、`~/.agents/mcp.json`、`~/.agents/mcp/mcp.json` 和 `<agentDir>/mcp.json`。省略表示全部保持原样；写 `[]` 表示禁用所有用户级 server。项目级 server（`.pi/mcp.json`）由 Pi 自己读取，profile 不会收窄。旧的 SSE server 无法选择。
- 旧版 profile 用 `tools` 里的 `mcp__*`、`<server>_*` 表达 MCP 工具访问；现在请改用 `mcp_tools`。
- 未声明的字段完全保持原生 Pi 行为。

实例目录里的 `mcp.json` 由启动器生成。在会话里执行 `pi mcp add` 只会改到这份生成副本，下次切换 profile 或重载时会被覆盖——要永久生效，请直接修改你自己的 MCP 配置。

[`examples/`](examples/) 里有上面的完整示例和初始 `ask`。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/profile` | 显示可选 profile 并选择（TUI 里是交互式选择器，非 TUI 下打印列表）。 |
| `/profile use <name>` | 立即切换 profile。会话会用新资源重载；切换失败会回滚。选择会被记住，下次启动继续使用。 |
| `/profile reload` | 修改 profile 文件后重新读取。 |
| `/profile status` | 显示当前 profile、解析出的资源与路径、overlay、MCP server 状态以及冲突。 |
| `/profile overlay disable\|enable skill\|extension\|mcp\|tool <name-or-glob>` | 只对当前会话收窄或恢复资源。 |
| `/profile overlay clear` | 去掉 overlay，按 profile 本来的写法运行。 |

以上命令在所有模式下都可用，包括非交互模式（`--mode text`、`--mode json`、`--mode rpc`）。overlay 只作用于当前运行期：不会写入 profile 文件，重启后即消失。内建的 `default` profile 不能用 overlay 禁用 MCP server——它没有可供收窄的 MCP 白名单。

## 文档

- 字段参考：[`schemas/profiles.schema.json`](schemas/profiles.schema.json)
- 架构与术语：[`docs/architecture/overview.md`](docs/architecture/overview.md)、[`CONTEXT.md`](CONTEXT.md)
- 设计决策：[`docs/adr/`](docs/adr/)
- Profile 编写指南：[`skills/profile-config/SKILL.md`](skills/profile-config/SKILL.md)

## License

MIT
