# pi-profile-switch 架构

## 总体结构

两个进程，通过 instance 目录上的文件通信——没有内存共享。

```text
┌──────────────────────────────────────┐
│  pi-profile launcher（Node，父进程）  │
│  bin/pi-profile.ts + src/launcher/    │
└────────────────┬─────────────────────┘
                 │ 解析 profile → 解析资源 → 物化 instance
                 │ spawn：PI_CODING_AGENT_DIR=<instance>  -e <extension>  <用户参数原样>
                 ▼
┌──────────────────────────────────────┐
│  pi（子进程，真实 Pi 二进制）          │
│  ┌────────────────────────────────┐  │
│  │  pi-profile extension          │  │
│  │  extensions/pi-profile/index.ts│  │
│  │  /profile 命令族 · 切换编排     │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

外部 interface 只有三处：CLI 参数、`/profile` 命令、catalog schema。资源过滤本身由 Pi 原生 settings 机制执行（ADR-0005），pi-profile 不实现过滤。

launcher 与 extension 之间的唯一通道是 instance 目录：launcher 写出 `settings.json`、`pi-profile.json`、`mcp.json`、`APPEND_SYSTEM.md`，extension 在 `session_start` 读 `pi-profile.json` 得到本轮 ActivationPlan。会话内切换时 extension 就地重写同一批文件并触发 `ctx.reload()`，Pi 重新读取磁盘——这是切换无需重启进程的原因（ADR-0005）。

## 过滤模型

profile 只接管四类资源（skills、extensions、MCP servers、tools），其余类别原样穿过。每一类都用 Pi 已有的机制实现，不新增拦截层。收窄只作用于用户级资源（真实 agentDir 与 `~/.agents/skills`）：项目级资源由 Pi 的项目信任判定决定，见下表。

| 作用域 | Pi 机制 | 形态 |
| --- | --- | --- |
| agentDir 级（`skills`、`extensions`） | 发现根随 `PI_CODING_AGENT_DIR` 移走，天然不发现；settings 数组写入选中的绝对路径 | 白名单（附加路径） |
| `~/.agents/skills`（HOME 级，无法抑制） | 始终自动发现，因此 settings 数组写入 `-<绝对路径>` 强制排除未选中项 | 补集排除 |
| 项目级（`.pi/skills`、`.pi/extensions`、ancestor `.agents/skills`） | 归 Pi：instance 的 `trust.json` 链接指向真实 trust store，Pi 按已存储决定自动发现。命名 profile 的生成 settings 仍置 `defaultProjectTrust: "never"`，但那只是不发起信任询问（已存储决定优先于它）。收窄契约见 `openspec/specs/resource-reference/spec.md` 的「项目级资源的收窄边界」 | 不由 profile 收窄 |
| packages（用户已配置包） | settings `packages` 数组改为对象形式，按类型写 allowlist glob | 白名单 |
| packages（项目） | 由 Pi 原生读取项目 `.pi/settings.json` 并装到项目 `.pi/npm` 下；generated settings 不合并项目 settings，因此不会成为全局 npm 根的安装副作用 | 原生 |
| tools | settings `defaultTools` 作为内置工具 boot 基线；extension 在 `session_start` 与 reload 后按 `pi-profile.json` 里的 tool 引用对 Pi 实时注册表展开并 `setActiveTools` | 白名单 |
| MCP servers | instance 的 `mcp.json` 只保留允许的 server，并把未允许的用户级共享 server 显式标为禁用；项目 `.mcp.json` / `.pi/mcp.json` 的 server 不由 profile 收窄。未声明 `mcps` 时软链真实 `mcp.json` | 白名单（文件过滤） |
| prompts、themes（未接管） | 用户数组原样保留，并重新包含真实 agentDir 的对应目录；项目级的那份由 Pi 原生发现 | 穿过 |

`default` profile 不生成任何过滤：settings 是用户全局 settings 的逐字拷贝，重新包含真实 agentDir 的 `skills`/`extensions`/`prompts`/`themes` 四个目录（因为发现根已移走），不置 `defaultProjectTrust`，行为与原生 Pi 一致。

## 模块与接口

### CLI 与 launcher（pi 进程之外）

| 模块 | 接口 |
| --- | --- |
| `bin/pi-profile.ts` | 入口。消费首个位置参数（profile 名）与其后的 `--`，其余原样成为 pi 的 argv |
| `launcher/args.ts` | `parseLauncherArgs(argv)` → `{ profile, piArgs, trustOverride }`；`--approve`/`--no-approve` 被改写为 trust 输入 |
| `launcher/initial-profile.ts` | 位置参数或已保存的活动 profile → `InitialProfile`；未知 profile 在此失败 |
| `launcher/discovery.ts` | `discoverLauncherResources()` → launcher 侧只读发现结果（skills、包根），供 resolver |
| `launcher/model-check.ts` | `checkDeclaredModel(agentDir, model)` → 错误消息或 undefined |
| `launcher/spawn.ts` | `generateRuntimeDir` 的结果 + 用户参数 → spawn pi，写 `pid` 活性文件，转发信号与退出码 |
| `launcher/runtime-cleanup.ts` | 启动时按 `pid` 活性清扫陈旧 instance 目录 |

### 解析（launcher 与会话内共用）

| 模块 | 接口 |
| --- | --- |
| `profile-catalog.ts` | catalog 只读面：`ProfileCatalog` 列出并解析 winning 定义，输出 `ResolvedProfile`（含 `source: builtin \| global \| project`） |
| `profile-catalog-store.ts` | catalog 写入侧（`profiles.json`），只在 TUI CRUD 路径使用 |
| `project-trust.ts` | `resolveProjectTrust(input)` → boolean；镜像 Pi 判定序，决定 pi-profile 是否读取项目 catalog、项目状态与项目 MCP 配置（项目级资源本身归 Pi） |
| `skill-registry.ts` | `discoverSkills(options)` → `SkillEntry[]`；只读调用 Pi SDK 的 discovery，不自行扫描目录 |
| `extension-discovery.ts` | `discoverExtensions(options)` → `DiscoveredExtensions`（只读，从不执行扩展代码）；`.select(refs)` 解析包名、别名、散装文件 stem、glob、绝对路径 |
| `mcp-config.ts` | `discoverAdapterServerNames()` → adapter 已配置的 server 名；`loadMergedMcpServers()` 供 instance `mcp.json` 生成 |
| `profile-resolver.ts` | `resolveProfile(input)` → 不可变 `ActivationPlan`（skills、extensions、tools、MCP、model、instructions、`unmatched`、`filter`） |

### 物化与状态

| 模块 | 接口 |
| --- | --- |
| `workspace.ts` | `~/.pi-profile-switch` 工作区路径（`PI_PROFILE_SWITCH_DIR` 可覆盖）与 legacy fallback |
| `json-file.ts` | 文件型 store 的共享 JSON 读取 |
| `settings-generator.ts` | `generateRuntimeDir(plan, options)`（launcher，建目录）与 `writeRuntimeFiles(runtimeDir, plan, options)`（会话内，就地重写）→ 生成文件 + symlink 组 + `{ PI_CODING_AGENT_DIR }` |
| `runtime-state-store.ts` | 按 source scope 读写 `pi-profile-state.json`（`activeProfile`、`overlay`） |

### 会话内（pi 进程之内）

| 模块 | 接口 |
| --- | --- |
| `extensions/pi-profile/index.ts` | 注册 `/profile` 命令族、profile selector、CRUD 向导与状态展示；经 `-e` 加载 |
| `switching/switch-profile.ts` | `switchProfile(profile, deps, options)` → `SwitchResult`；编排快照 → 重写 → reload → 回滚 |
| `switching/apply-plan.ts` | `readLaunchPlanFile(runtimeDir)` + `applyLaunchPlan(input)`；`session_start` 与 reload 后应用 tools 白名单、持久化 runtime state、发一次性变更摘要 |
| `switching/customize.ts` | `customizeOverlay` / `resetOverlay` / `parseCustomizeArgs`；runtime overlay 的读写 |
| `switching/profile-crud.ts` | create / edit / delete / duplicate 的语义层 |
| `switching/profile-wizard.ts` | create / edit / duplicate 的交互向导，UI 经参数注入 |
| `switching/list-profiles.ts` | `/profile list`，含 trust 门控与 `shadowsGlobal` 标记 |
| `switching/status.ts` | `buildStatusReport` / `formatStatusMarkdown`；解析后路径、overlay、MCP 三态、冲突 |
| `switching/tool-references.ts` | `expandToolReferences(refs, liveToolNames)`；tool 引用对 Pi 活动注册表的展开 |

## 激活流程

### 启动

```text
pi-profile review -- --mode rpc
  │
  ├─ parseLauncherArgs：取 review、拦 --approve、其余透传
  ├─ ProfileCatalog 解析 review 的最终来源
  ├─ project-trust 读取真实 trust.json 得到 projectTrusted
  ├─ skill-registry + extension-discovery + mcp-config 只读发现
  ├─ resolveProfile → ActivationPlan（glob 展开、overlay 应用、unmatched 收集）
  ├─ 校验：声明的模型已认证、extension 入口存在、MCP adapter 与 server 存在
  ├─ generateRuntimeDir → 本次 instance 目录（生成文件 + seed + symlink 镜像 + env）
  └─ spawnPi：-e <extension> [trust flag] <用户参数原样>
       └─ extension 在 session_start 读 pi-profile.json，展开 tools 并 setActiveTools
```

### 会话内切换

```text
/profile use implement
  │
  ├─ 校验与 resolve（与启动同一路径）
  ├─ ctx.waitForIdle()
  ├─ 快照受管运行时文件（settings / plan / mcp / appendSystem / trust）
  ├─ 就地重写 settings.json、pi-profile.json、mcp.json、APPEND_SYSTEM.md，trust.json 链接保持不变
  ├─ ctx.reload()：Pi 重读磁盘、重建资源、重新执行 extension
  │    ├─ extension 重新应用 tools 白名单
  │    └─ state.activeProfile 由 reload 后的新 extension 实例按 source scope 写入
  ├─ 成功 → 下一个 agent turn 收到一次性变更摘要
  └─ 失败 → 写回快照并再次 reload，runtime 不出现半切换
```

sessionId 与消息历史在 reload 前后不变（ADR-0005 已验证）。

## 运行目录

每次启动生成一个 instance 目录，路径为 `<PI_PROFILE_SWITCH_DIR>/instances/launch-<随机标识>`（工作区根默认为 `~/.pi-profile-switch`，`PI_PROFILE_SWITCH_DIR` 可覆盖），经 `PI_CODING_AGENT_DIR` 交给 pi。路径与一次启动绑定、不复用：`PI_CODING_AGENT_DIR` 在子进程内不可变更，固定路径既无法跟随会话内切换，也会让并发启动互相重写文件（ADR-0010）。

受管文件、镜像与清扫规则是契约，见 `openspec/specs/launcher/spec.md` 的「instance 目录契约」「陈旧 instance 清扫」「instance 运行时状态 seed」。以下是每个受管文件的用途：

| 文件 | 内容 |
| --- | --- |
| `settings.json` | 用户全局 settings + 按过滤模型的数组改写（只含用户级资源，不并入项目 settings） |
| `pi-profile.json` | 本轮 ActivationPlan，供 pi 内 extension 在 `session_start` 读取 |
| `mcp.json` | 过滤后的 MCP server 集合 |
| `APPEND_SYSTEM.md` | profile 的 `instructions`，Pi 原生追加到 system prompt |
| `trust.json` | 指向真实 trust store 的符号链接，Pi 的项目级发现以它为准，会话内切换不改动它；形态与建立条件见 `openspec/specs/launcher/spec.md` 的「instance 目录契约」 |
| `pid` | 子进程活性标记，上次启动的清扫据此判定回收 |
| `extensions` | 受管目录，使 agentDir 级 extension 只经白名单进入 |

真实 agentDir 下的其余条目都保持原位，靠符号链接进入 instance；生成时还不存在、却在运行时被创建的条目由下节的 seed 处理。这些状态因此从不被复制：`npm/`、`git/`、`bin/` 是包安装根，`sessions/` 保留 Pi 原生的分目录结构、session 文件始终写在真实 agentDir。用户配置文件从不被修改。

### 运行时状态的 seed

镜像是生成时刻的快照：只有生成时已存在于真实 agentDir 的条目会被链接。**运行时才被创建**的条目必须靠 seed，否则会落在 instance 内——既随 instance 被清扫，也让第三方记录写进 instance 路径。

当前 seed 哪些路径、以什么形态，是行为契约，见 `openspec/specs/launcher/spec.md` 的「instance 运行时状态 seed」。这里只记两条维护规则：

- 名单只收录有**观察证据**的条目（某次真实运行确实在 agentDir 下创建了它），不能靠推断；未被收录的条目由清扫保留并告警，不会静默销毁。
- 目录可以直接创建（空目录语义无歧义）；文件不能预先创建，因为内容属于 Pi。文件用**允许悬空**的软链：Pi 的 `existsSync` 视为“不存在”，写入时穿透软链在真实 agentDir 落成真文件，格式始终由 Pi 拥有。seed 步骤放在失效链接清理之后，否则悬空链会被自身的清理逻辑删掉。

### instance 清扫

清扫发生在启动时（生成本次 instance 之前），而不是退出时：任何退出方式都会结束 pid，下次启动的清扫必然收敛，因此不必在信号路径上放删除逻辑。判定规则、保留条件与警告要求是契约，见 `openspec/specs/launcher/spec.md` 的「陈旧 instance 清扫」；该判定为何不比对真实 agentDir，见 ADR-0010。

### 生成 settings.json 示例

阅读便利，非稳定面：该格式随 Pi 版本演进，漂移由集成测试发现。权威定义是 Pi 自身的 settings schema。

```json
{
  "defaultProjectTrust": "never",
  "skills": [
    "/home/user/.pi/agent/skills/git-commit",
    "-/home/user/.agents/skills/secret-*"
  ],
  "extensions": [
    "/opt/pi-resources/review-guard/index.ts"
  ],
  "packages": [
    { "source": "npm:pi-skills", "skills": ["code-review"], "extensions": [] }
  ]
}
```

### 用户配置契约

`profiles.json`（全局 `~/.pi-profile-switch/profiles.json`，项目 `.pi/profiles.json`）与 `pi-profile-state.json` 的 schema 权威定义是 `schemas/profiles.schema.json`。核心字段：profile 的 `skills`/`extensions`/`mcps`/`tools`（名称或 glob）、可选 `defaultProvider`/`defaultModel`/`defaultThinkingLevel` 与 `instructions`；state 的 `activeProfile` 与 `overlay`。

## 已知限制

| 限制 | 代价 |
| --- | --- |
| profile 不参与项目级资源 | 已信任项目的 skill、extension 与 MCP server 在任何 profile 下都可用，只读风格的 profile 也不能隐藏它们——项目信任是唯一闸门；未受信任时项目级资源一律不可见 |
| 项目 `.pi/settings.json` 的行为键覆盖 profile 声明 | Pi 的合并顺序是项目覆盖 global，因此项目的 `defaultProvider`/`defaultModel`/`defaultThinkingLevel` 会压过 profile 的声明；`defaultTools` 只影响启动基线（extension 在 session start 会重新收紧工具） |
| 不咨询 extension 的 `project_trust` 事件 | 咨询需要在 launcher 里执行扩展代码；依赖该事件的第三方 extension 无法影响 trust 判定 |
| `pi install` 与 `pi config` 在会话内写生成的 settings | 退出后丢失；持久改动需走 `/profile edit` 或原生 `pi` |
| 0.4.x 遗留的 `instances/<profile>/agent` 目录不被新清扫触及 | 既不清理也不迁移，需用户自行处置；其中的 pi-subagents mission 记录带指向旧 instance 路径的绝对路径，无法修复（见 ADR-0010） |
| 并发 instance 对凭据文件的写入不互相串行化 | `auth.json` 与 `models-store.json` 通过 seed 软链共享，但 Pi 的锁落在软链路径旁，两个会话不会互相串行化，可能丢失一次并发刷新（见 ADR-0010） |
| 项目 package 提供的 skill 不可引用 | 它随 Pi 原生加载而可见，但不出现在 profile 的引用词汇表里；项目 `.pi/skills` 与 ancestor `.agents/skills` 可引用 |

## 包结构

| 分组 | 内容 |
| --- | --- |
| `bin/` | CLI 入口与 postinstall。发布态的 `pi-profile.js` 是 jiti 包装器——Node 拒绝对 `node_modules` 下的 `.ts` 做 type-stripping，而 launcher 需要加载共享的 TS 图；开发态直接运行 `pi-profile.ts`。`postinstall.js` 用 `examples/profiles.json` 播种全局 catalog 的 starter `ask` profile |
| `extensions/pi-profile/` | pi 进程内的 extension：`/profile` 命令族、切换编排、状态展示 |
| `src/launcher/` | spawn 前的全部工作：参数解析、初始 profile 解析、只读发现、模型校验、spawn、陈旧目录清扫 |
| `src/switching/` | 会话内切换、overlay、CRUD、可观测面 |
| `src/*.ts` | catalog、trust、发现、resolver、settings 生成、状态存储等两侧共用模块 |
| `schemas/` | `profiles.schema.json`，用户配置的权威定义 |
| `examples/` | `profiles.json`（播种用 starter）与 `example.json`（全字段示例） |
| `test/` | Vitest：`*.test.ts` 单元 + `*.integration.test.ts` 真实子进程 |

`package.json` 同时声明 Pi extension 与 `pi-profile` binary：extension 提供对话内交互，binary 负责初始解析与 spawn。`files` 发布 `bin`、`extensions`、`src`、`schemas`、`examples`、`README`。
