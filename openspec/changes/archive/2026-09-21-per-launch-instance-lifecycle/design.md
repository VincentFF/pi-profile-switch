# Design

## Context

动机见 `proposal.md`。以下是塑造方案、且不写在别处的现状约束：

- `PI_CODING_AGENT_DIR` 在子进程启动后不可变更。会话内 `/profile use` 只能重写当前 instance 目录，因此"目录名等于 profile 名"的固定路径在会话内切换后必然名不副实。
- instance 的符号链接镜像是**生成时刻的快照**：只有真实 agentDir 里已存在的条目会被链接；运行时在 instance 内新建的条目只存在于该 instance。
- pi-subagents 的 store 由 `getAgentDir()` 派生（`<agentDir>/missions/projects/<project-hash>/`），它的台账 `missions/index/*.json` 记录**绝对** `recordPath`；读取台账时路径不存在就把该指针当 stale 删除。记录本体则按目录读取（`readMission` / `listMissions` 走 `missionDir/<id>.json`）。
- pi-profile 自身的运行时状态在 `~/.pi-profile-switch/pi-profile-state.json`，不在 instance 内，不受 instance 生命周期影响。
- 清扫所需的 pid 活性机制及其宽限期（覆盖 `mkdir` 到写 pid 之间的竞争、以及写出 pid 前崩溃）已经存在，可原样沿用。

## Goals / Non-Goals

**Goals:**

- instance 的生命周期等于一次启动：同一 profile 并发启动互不干扰，会话内切换改到的目录只属于该会话。
- 死 instance 目录能收敛回收，且回收不销毁未被 pi-profile 生成的数据。
- 运行时新建的第三方状态落在真实 agentDir，不在 instance 内产生第二份、也不把 instance 路径写进第三方数据。

**Non-Goals:**

- 不迁移、吸收或改写 0.4.x 与 0.1–0.3 的遗留目录及其中的绝对路径。
- 不自动发现第三方扩展的状态目录（发现需要执行扩展代码，已被既有设计排除）。
- 不为受管目录内部的第三方状态（如 `extensions/` 下的扩展配置）做内层 seed；留到出现未识别条目时由警告点名。
- 不引入退出时删除。

## Decisions

### 1. 每次启动一个唯一 instance 目录

路径形态 `instances/launch-<随机标识>`，它就是交给 Pi 的 agentDir。随机标识由生成流程产生，`pid` 写在 instance 根。

被否方案 A：保留 `instances/<profile>/agent`。同一 profile 的并发启动会互相重写受管文件与 `pid`，会话内切换会改到别的会话正在使用的目录，且目录名会在切换后与内容不符。
被否方案 B：路径按 profile 固定、内容每次整目录替换以保证一致。路径仍然按 profile 共享，会话内切换的并发冲突不变。
被否方案 C：始终稳定的路径 + 什么都不替换。就是现状，等于放弃回收。

ADR required: per-launch-instance-lifecycle

### 2. 回收只发生在启动清扫，退出时不删除

任何退出方式（正常、信号、`SIGKILL`、断电）都会结束子进程，`pid` 因此成为可判定事实，下次启动的清扫必然收敛；最坏情形是残留一个目录。把删除放在退出路径上只能换来即时干净，代价是在信号路径上引入删除逻辑。

### 3. "未识别条目"的口径不比对真实 agentDir

判定为未识别的条件是：不是符号链接、也不是 pi-profile 的受管生成物。受管目录（如 `extensions/`）内部也要看，因为第三方可能把自己的配置写在受管目录里。命中就保留目录并输出警告，而不是删除。

关键点是**不**使用"真实 agentDir 里已有同名条目"作为可以删除的条件：seed 一旦在真实 agentDir 里建出 `missions`，遗留目录里的同名真实目录就会被这一条件判成"有对应物"，从而被静默删除——正是这套规则要防的事故。

### 4. 用 seed 软链把运行时状态锚在真实 agentDir

镜像之前先把 Pi 会在运行时创建的状态路径 seed 出去，再由既有的全量镜像逻辑生成 instance 内的软链：

- 目录（`sessions`、`missions`）在真实 agentDir 下缺失时创建（空目录无内容语义，安全），镜像后 instance 内即为软链。`sessions` 已是同一形态的先例。
- 文件（`auth.json`、`models-store.json`）不能预先创建，因为内容是 Pi 的；改为在 instance 内建立**允许悬空**的软链。Pi 对不存在采用 `existsSync`，悬空链因此被看作“没有文件”，写入时穿透软链在真实 agentDir 落成真文件（已核实 Pi 用 `writeFileSync` 原地写、不 rename，`normalizePath` 也不做 realpath）。seed 步骤放在失效链接清理之后，否则悬空链会被清掉。

效果是第三方与 Pi 从第一次启动起写入的就是真实路径，台账里的 `recordPath`、记录里的 `ownerSessionId` 与 artifacts 路径永不包含 instance 路径。

被否方案 A：回收时吸收（把未识别条目搬进真实 agentDir）。已落盘的 `recordPath` / `ownerSessionId` / `artifacts[].path` 指向被删除的 instance 路径，搬走之后台账会把指针当 stale 清空；要修就得改写第三方文件格式，且需要一套冲突合并策略。
被否方案 B：把 `missions` 指向项目 `.pi/subagents/missions`。launcher 会替未受管、甚至未受信任的项目创建文件，破坏信任守门。
被否方案 C：枚举更多第三方状态目录。名单是兼容债，扩展换路径就静默失效；只收录有观察证据的条目，其余交给决策 3 的警告兜底。
被否方案 D：按 Pi 的空值把 `auth.json` / `models-store.json` 自己建出来（内容是 `{}`）。锁会落在真实路径上，但把 Pi 的内部空值形状写死：Pi 以后换格式而不重写文件时会留下陈旧文件，而软链方案让 Pi 自己拥有文件格式。

ADR required: per-launch-instance-lifecycle

### 5. 不做旧形态兼容

清扫只处理本次生成形态（`launch-` 前缀），其他目录既不删除也不迁移。这样旧版本遗留目录不会被升级后的清扫误判，代价是它们永久残留（写入架构文档的已知限制）。

## Risks / Trade-offs

- seed 名单随第三方改路径而静默失效 → 决策 3 的警告把它变成可见、可行动的失败；架构文档中的名单表注明"加条目必须有观察证据"。
- 文件类 seed 用悬空软链：Pi 对 `auth.json` / `models-store.json` 用 `proper-lockfile` 锁在 `<instance>/auth.json.lock`（软链路径旁），两个并发 instance 因此不会串行化对同一个真实文件的写，理论上可能丢一次凭据刷新。这是本变更之前 per-profile 副本就有的同类缺口，尚未观察到实际影响；若需要锁的强一致，只能改回“自己按 Pi 的空值建文件”（被否方案 D）。
- 宽限期内的死目录暂时残留 → 下次启动回收，磁盘代价为 KB 级。
- PID 复用导致应回收的目录被误保留 → 自愈：该 pid 结束后即被回收。
- 启动失败（写出 pid 之前崩溃）留下的目录与并发启动竞争 → 宽限期覆盖，不会被另一个 launcher 误删。
- seed 会在真实 agentDir 下创建空目录（`sessions`、`missions`）→ 与既有行为一致，只创建目录本身，不写入内容；文件类路径不创建。
- 进程被强杀时 `proper-lockfile` 可能留下 `<auth.json>.lock` 之类的条目 → 被当作未识别条目保留并告警，不会静默删除。
- 升级后 0.4.x 目录永久残留，其中的 mission 记录带旧绝对路径 → 由架构文档的已知限制与迁移说明覆盖。

## Migration Plan

无自动迁移代码。升级后：新的 instance 目录按 `launch-` 形态生成；旧的 `instances/<profile>/agent` 保持原样，需要时由用户自行删除。其中的 mission 记录可直接复制进真实 agentDir 的对应项目目录继续被列出与恢复，但记录内的路径字段仍指向旧路径。若要长期避免这类问题，用户可把 pi-subagents 的 `missions.directory` 指到一个固定路径，新记录就不再依赖 agentDir。
