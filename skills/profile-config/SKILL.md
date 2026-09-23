---
name: profile-config
description: 指导创建、修改或删除 pi-profile-switch 的 profile。当用户想要创建、修改、配置或删除 profile 时触发。
---

# profile-config

本 skill 指导 agent 理解用户的模糊需求或明确指令，协助用户创建、修改或删除 `pi-profile-switch` 的 profile 文件。

> **声明**：本 skill 文件由 `pi-profile-switch` package 安装分发并在随包升级时自动覆写，请勿手动修改此文件。

---

## 1. 核心概念与约束

### 1.1 Profile 与 Catalog
- **Profile**：命名的能力定义，引用 skills、extensions、MCP servers 与 tools，可选声明 model、thinking level 与 instructions。
- **Catalog**：保存 profile 定义的 `profiles/` 目录。每个 profile 对应目录下的一个独立 JSON 文件：`<name>.json`。
- **default profile**：由 Pi 提供，不可删除、不可编辑的 profile，加载 Pi 可发现的全部资源。**严禁**在任何 profiles 目录下创建 `default.json`。

### 1.2 名字字符集规范
Profile 名字必须完全匹配正则：
```regex
^[A-Za-z0-9][A-Za-z0-9._-]*$
```
- 必须以英文字母或数字开头。
- 只允许英文字母、数字、点（`.`）、下划线（`_`）和连字符（`-`）。
- 不允许包含空格、中文或特殊符号。

### 1.3 作用域（Source scope）与存储落点
Profile 文件存放在两个位置之一：

| 作用域 | 路径 | 说明 |
| --- | --- | --- |
| **全局（global）** | `$PI_PROFILE_SWITCH_DIR/profiles/<name>.json`<br>（缺省为 `~/.pi-profile-switch/profiles/<name>.json`） | 对所有项目通用。若环境变量 `PI_PROFILE_SWITCH_DIR` 存在且非空，则以其下的 `profiles/` 目录为准。 |
| **项目（project）** | `<projectDir>/.pi/profiles/<name>.json` | 仅在当前项目生效，且仅当项目已受信任时可用。 |

- **覆盖规则**：项目 scope 的同名 profile 会完整替换（replace）全局条目，**不会**与全局配置合并字段。
- **项目信任门禁**：若当前项目未受信任，项目 scope 的 profile 无法解析，向项目 scope 写入也会失败。写入项目 scope 前若项目未受信任，必须提示用户在会话中执行 `/trust` 并重启 Pi。

---

## 2. Profile 文件格式与字段定义

文件内容必须为格式化 JSON，**顶层即为裸定义对象**，严禁包裹 `schemaVersion`、`profiles` 或其他外层信封字段。

全部字段均为可选（optional）。未声明的字段保持原生 Pi 行为或当前状态，不产生任何副作用。

### 字段详细语义

| 字段 | 类型 | 语义与约束 |
| --- | --- | --- |
| `label` | `string` | 人类可读的显示名称（如 `"Code Review"`）。 |
| `description` | `string` | Profile 的简要描述（如 `"Read-only review profile"`）。 |
| `skills` | `string[]` | 引用的 skill 名称或 glob 列表。未声明时不收窄可用 skills。 |
| `extensions` | `string[]` | 引用的 extension 标识或 glob 列表。未声明时不收窄可用 extensions。 |
| `mcps` | `string[]` | 引用的 MCP server 名称或 glob 列表。未声明时不依赖 `pi-mcp-adapter`。 |
| `tools` | `string[]` | 白名单工具名称或 glob 列表。未声明时不收窄工具，保持 Pi 原生工具集合。 |
| `defaultProvider` | `string` | 默认模型提供商（如 `"anthropic"`、`"openai"`）。与 `defaultModel` 必须同时声明才生效。 |
| `defaultModel` | `string` | 默认模型名称（如 `"claude-sonnet-4-5"`）。与 `defaultProvider` 必须同时声明才生效。 |
| `defaultThinkingLevel` | `string` | 默认思考等级，可选值：`"off"`、`"minimal"`、`"low"`、`"medium"`、`"high"`、`"xhigh"`、`"max"`。仅在模型声明成立时生效。 |
| `instructions` | `string` | 激活该 profile 时追加到系统提示词的指令文本。 |

### 示例格式
```json
{
  "label": "Review Mode",
  "description": "Read-only code review with linting and analysis tools",
  "skills": [
    "profile-config"
  ],
  "extensions": [],
  "mcps": [],
  "tools": [
    "read",
    "grep",
    "find",
    "ls"
  ],
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5",
  "defaultThinkingLevel": "high",
  "instructions": "Focus on code quality, security, and edge cases. Do not edit files."
}
```

---

## 3. 可引用资源发现指引

当帮助用户配置 profile 时，可检查或参考以下位置发现用户当前已有的可用资源：

1. **Skills**：
   - 发现位置：`<agentDir>/skills/` 以及全局 `~/.agents/skills/`。
   - 引用身份：Pi 的 skill 名称（即 skill 目录下的 `SKILL.md` frontmatter 中声明的 `name`，或目录名）。
   - 支持 glob（如 `"git-*"`）。
2. **Extensions**：
   - 发现位置：`<agentDir>/settings.json` 中声明的已安装 packages、`<agentDir>/extensions/` 下的散装文件（`.ts` 或 `.js`）。
   - 引用形式：
     - 已安装包的包名或 source 别名。
     - 多入口包的入口 ID：`<包名>:<相对路径>`。
     - 散装文件 ID：相对扩展目录的路径去掉 `.ts`/`.js`（如 `sub/index.ts` 引用为 `sub`）。
     - 绝对路径或 `~/` 路径。
     - glob 匹配。
3. **MCP Servers**：
   - 发现位置：`pi-mcp-adapter` 识别的标准配置位置——全局侧 `~/.config/mcp/mcp.json`、`~/.agents/mcp.json`、`~/.agents/mcp/mcp.json`、`<agentDir>/mcp.json`；受信任项目另有 `<projectDir>/.mcp.json` 与 `<projectDir>/.pi/mcp.json`。
   - 引用身份：上述配置文件中 `mcpServers` 对象下的 server 键名。
   - 声明了 `mcps` 的 profile 需要同时确保 `pi-mcp-adapter` extension 处于可用状态。
4. **Tools**：
   - 引用身份：Pi 实时工具注册表中的工具名。
   - 包括内建工具（`read`、`write`、`edit`、`bash` 等）、extension 贡献的工具、以及 MCP server 暴露的工具（代理工具 `mcp__<server>` 与直接工具 `<server>_<tool>`）。
   - 支持 glob（如 `"mcp__*"`、`"github_*"`）。
5. **项目级资源的收窄边界（重要）**：
   - Profile 的资源选择（`skills`、`extensions`）**仅作用于用户级资源**（真实 agentDir 与 `~/.agents/skills`）。
   - 项目级资源（如项目 `.pi/skills`、项目 `.pi/extensions`、上级 `.agents/skills`）的可见性由 Pi 项目信任判定决定：在受信任项目中，它们在**任何** profile 下都始终可见；在未受信任项目中均不可见。
   - 因此，项目级资源的可见性**不随 profile 收窄**，无需也不指导在 profile 中声明项目级资源。

---

## 4. 创作时的默认注入规则

当为用户创建或生成声明了 `skills` 的新 profile 时，必须遵守以下约定：

1. **默认注入 `"profile-config"`**：
   - 若生成的 profile 声明了 `skills` 数组，默认在 `skills` 列表中包含 `"profile-config"`，以保证切入该 profile 后用户仍可继续通过本 skill 配置 profile。
   - **例外 1**：用户明确要求不包含 `"profile-config"` 时除外。
   - **例外 2**：若 `skills` 列表中已包含具有覆盖性的 glob（例如 `"*"`），则无需重复显式添加 `"profile-config"`。
2. **未声明 `skills` 时不动作**：
   - 若 profile 未声明 `skills` 字段，表示不收窄 skills，全部 skill（包括 `profile-config`）天然可用，因此绝对不要主动添加 `skills` 字段。

---

## 5. 交互与执行流程

### 5.1 创建（Create）
1. **需求澄清**：根据用户自然语言描述（如「帮我配一个用于安全审计的只读 profile」），明确：
   - 目标名称（校验符合 `^[A-Za-z0-9][A-Za-z0-9._-]*$`，且非 `default`）。
   - 目标 scope（全局还是项目级）。
   - 需要收窄的工具、skills、extensions、MCP servers 或特定模型设定。
2. **资源与环境核对**：根据上述规则构造合法 JSON 定义，应用创作时默认注入规则。
3. **写入文件**：
   - 全局路径：`$PI_PROFILE_SWITCH_DIR/profiles/<name>.json`（默认 `~/.pi-profile-switch/profiles/<name>.json`）。
   - 项目路径：`<projectDir>/.pi/profiles/<name>.json`。
   - 确保目录存在，写入格式化的 JSON。
4. **提示用户生效**：告知用户可通过 `/profile reload` 或 `/profile use <name>` 立即使用新 profile。

### 5.2 修改（Edit）
1. 读取目标 profile 文件已有内容。
2. 根据用户要求调整对应字段，保持其余字段完整。
3. 校验并写回格式化 JSON。
4. 提示用户执行 `/profile reload`。

### 5.3 删除（Delete）
1. 确认要删除的 profile 存在于指定 scope。
2. 严禁尝试删除 `default` profile。
3. 删除对应的 `<name>.json` 文件。若当前正在使用该 profile，提醒用户先切换到其他 profile（如 `/profile use default`）。

---

## 6. 边界与退化处理

1. **只读 / 无 `write` 工具环境**：
   - 如果当前会话处于收窄工具的 profile 中（例如没有 `write` 工具的只读模式）：
   - 退化为在回复中输出完整的格式化 JSON 内容与建议保存的文件绝对路径，建议用户手动保存或切换至具备文件写入能力的 profile（如 `/profile use default`）后再行保存。
2. **未受信任项目**：
   - 如果需要写入项目 scope（`<projectDir>/.pi/profiles/`），而当前项目尚未受信任：
   - 必须向用户说明项目未受信任无法生效，提示用户执行 `/trust` 并重启 Pi，或改将 profile 保存至全局 scope。
