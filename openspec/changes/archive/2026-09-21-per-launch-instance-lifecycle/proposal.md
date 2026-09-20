# Proposal

## Why

instance 在 `CONTEXT.md` 里的定义是"为一次 Pi 进程生成的运行时目录"，但 0.4.x 的实现把它固定成 `instances/<profile>/agent`，同一个 profile 每次启动复用同一路径。三种后果同时存在：

- 同一 profile 并发启动会互相重写 `settings.json`、`mcp.json` 与 `pid`，会话内切换会改到另一个会话正在用的目录。
- 会话内 `/profile use` 之后，目录名与目录内容不符：`instances/review/agent` 里装的是 `implement` 的配置。
- 现存清扫实现扫的是 `<agentDir>/pi-profile/runtime/launch-*`，与 instance 路径不同，因此在生产环境恒为空操作，死目录永不回收。

同时，目录复用意外地给"运行时新建的第三方状态"提供了持久性：pi-subagents 的 mission store 落在 `<agentDir>/missions/`，于是它被按 profile 复制成互不相干的多份（同一 project hash 在本机 `default` 与 `ask` 各一份，记录已分叉）。

## What Changes

- **BREAKING** instance 路径从 `instances/<profile>/agent` 改为每次启动生成一个唯一目录 `instances/launch-<random>/`，它就是交给 Pi 的 agentDir；同一 profile 的多次启动不再复用同一路径。
- 启动时清扫 instance 根：`pid` 指向的进程已退出（`ESRCH`）则回收；`pid` 存活（含 `EPERM`）保留；没有可解析 `pid` 且目录 mtime 超过宽限期的回收。退出时不做删除。
- 生成 instance 前在真实 agentDir 里确保 `missions` 目录存在，使其被镜像成 instance 内的软链。第三方扩展写入的是真实路径，因此不需要迁移、吸收或改写第三方文件。
- 回收死 instance 目录时，若其中含未被 pi-profile 生成的"野生条目"（既不是软链，也不是受管生成物），则保留该目录并输出可行动警告，不静默销毁。
- 不做旧形态兼容：0.4.x 的 `instances/<profile>/agent` 与 0.1–0.3 的 `<agentDir>/pi-profile/runtime/launch-*` 不被新清扫触及，也不迁移。
- 不新增用户可见配置字段。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `launcher`: 「instance 目录契约」的路径与复用语义反转；新增「陈旧 instance 清扫」与「instance 运行时状态 seed」两条 requirement。

## Impact

- 代码：`src/settings-generator.ts`（instance 路径与 seed）、`src/launcher/runtime-cleanup.ts`（按 `instances/launch-*` 清扫 + 野生条目判定）、`bin/pi-profile.ts`（清扫调用）、`src/workspace.ts`（instance 根注释）。
- 测试：`test/runtime-cleanup.test.ts` 重写；`test/settings-generator.test.ts`、`test/project-scope.integration.test.ts`、`test/mcp.integration.test.ts` 中硬编码 instance 路径的断言改为在 `PI_PROFILE_SWITCH_DIR` 下发现目录。
- 升级影响：0.4.x 遗留的 `instances/<profile>/agent` 目录既不清理也不迁移，由用户自行处置；它们内含的 mission 记录带有指向旧 instance 路径的绝对路径，seed 只能保证今后不再产生这类路径。
- 并发：同 profile 并发启动变为互不干扰；真实 agentDir 上的共享状态（session 文件、mission store、package 安装根）与原生 Pi 的并发语义一致。

## Doc Impact

- `docs/prd.md`: none：定位、目标与各条非目标都不涉及 instance 生命周期，本次改动不改变产品契约。
- `docs/architecture/overview.md`: 「运行目录」整段改写（路径形态、pid 位置、seed、清扫规则、受管文件表）；「已知限制」中"instance 路径固定导致并发互相重写、已删除或改名 profile 的 instance 目录不被清理"一行删除，替换为"0.4.x 遗留 instance 目录不被新清扫触及"。
- `CONTEXT.md`: none：`instance` 的定义（"为一次 Pi 进程生成的运行时目录"）本来就描述 per-launch，本次改动只是让实现与定义一致。
- `docs/adr/`: 新增 `docs/adr/0010-per-launch-instance-lifecycle.md`，记录 instance 生命周期为 per-launch、被否掉的持久 per-profile 目录方案，以及"运行时新建状态以 seed 软链回落真实 agentDir"这一取舍。
