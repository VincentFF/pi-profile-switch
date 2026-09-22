# 术语表

## 领域术语

| 术语 | 含义 | 避免使用 |
| --- | --- | --- |
| **Profile** | 命名的能力定义：引用 skills、extensions、MCP servers 与 tools，可选声明 model、thinking level 与 instructions。 | preset、config、bundle、capability |
| **default profile** | 内建、不可删除、不出现在 catalog 文件中的 profile，加载 Pi 可发现的全部资源。 | built-in、内置 |
| **Catalog** | 持有 profile 定义的 `profiles/` 目录：全局一个，每个项目一个，每 profile 一个 `<name>.json` 文件。 | — |
| **Source scope** | profile 的来源，取值为 `builtin`、`global` 或 `project`，决定其运行时状态与编辑写入哪个 scope。 | — |
| **RuntimeOverlay** | 对活动 profile 的临时收窄：禁用已解析的 skill、extension 或 MCP server，或替换 tools 引用集合。通常简称 overlay。 | session profile、temporary profile |
| **Runtime state** | 持久保存的活动 profile 选择与 overlay。 | — |
| **Resource** | profile 可引用的任何能力：skill、extension、MCP server 或 tool。 | — |
| **Project trust** | Pi 对项目目录的信任决定，决定项目级 catalog 与项目资源是否参与解析。 | — |
| **pi-mcp-adapter** | 可选的 Pi 包，持有 MCP server 的配置、连接与凭证。 | — |

## 内部术语

| 术语 | 含义 | 避免使用 |
| --- | --- | --- |
| **ActivationPlan** | 由一个 profile 加一个 overlay 解析出的不可变资源与工具集合，由 ProfileResolver 产出。 | — |
| **SkillRegistry** | skill 名到最终 `SKILL.md` 的映射，镜像 Pi 的完整发现结果。 | — |
| **ExtensionDiscovery** | extension 的可引用视图：已安装包与标准目录下的散装文件，纯发现，无注册层。 | — |
| **McpServerRegistry** | `pi-mcp-adapter` 发现的 MCP server 名称与状态。 | — |
| **instance** | `pi-profile-switch` 为一次 Pi 进程生成的运行时目录，经 `PI_CODING_AGENT_DIR` 交给 Pi。 | — |
| **Generated settings** | 写入 instance 的 `settings.json`，把 profile 的资源选择编码为 Pi 原生 settings。 | — |
| **Runtime reload** | Pi 原生重新读取 settings 并重建资源，保留当前 session。 | — |
| **收养**（adoption） | 清扫处置之一：未识别条目经内容扫描确认不引用其所在 instance 路径后，被搬入真实 agentDir；收养后下次启动经镜像转为符号链接（ADR-0012）。 | 吸收 |
