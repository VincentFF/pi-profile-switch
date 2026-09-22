# Proposal

## Why

扩展（已观察到的案例：`pi-mcp-adapter` 写 `mcp-cache.json`）会在运行时往 `PI_CODING_AGENT_DIR`（即 instance 目录）写入镜像阶段不存在、pi-profile 也未生成的文件。启动清扫按 ADR-0010 的契约拒绝回收这类死目录，并在每次启动重复警告，直到用户手动搬运文件并删目录。扩大 seed 名单是对未来的预测，扩展改路径即静默失效，已被 ADR-0010 否决；无条件"回收时吸收"也因第三方记录内嵌 instance 绝对路径（pi-subagents 台账）被否决。需要一条不做预测、也不触碰内嵌路径记录的收敛路径。

## What Changes

- 启动清扫对死 instance 目录中未识别条目的处置，从一律"保留 + 警告"改为按内容扫描分流：
  - 条目内容（目录递归扫描，带体积/数量上限）引用其所在 instance 路径，或扫描超限，或为 socket/fifo 等非常规类型 → 保留 + 警告（现状行为不变）。
  - 否则且真实 agentDir 无同名条目 → 搬入真实 agentDir（收养），stderr 输出一行 notice。收养后下次启动经镜像转为符号链接，永久收敛。
  - 否则（真实 agentDir 已有同名条目）→ 删除 instance 内副本（real wins），stderr 输出一行 notice。该分支只在"真实条目于 instance 启动之后才出现"的竞态窗口触发，可能丢失 instance 副本独有的内容，属已接受的代价。
- `extensions/` 受管目录内部的未识别条目维持只警告，不参与收养。
- 清扫仍为 best-effort，任何单目录失败不阻塞启动（现状不变）。
- 不新增用户可见配置字段：分流判据（instance 路径出现与否）与去向（真实 agentDir）均由现有目录结构决定，无可由配置替代的决策点；扫描上限是实现内部常量。
- 新增 ADR-0012 记录该决策及其与 ADR-0010 否决意见的关系。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `launcher`: 「陈旧 instance 清扫」requirement——未识别条目的处置策略从一律保留并告警，改为按内容扫描分流为收养、删除（real wins）或保留并告警。

## Impact

- 代码：`src/launcher/runtime-cleanup.ts`（`unrecognizedEntries` / `sweepEntry` 分流逻辑）、`test/launcher.integration.test.ts`。
- 文档：`docs/architecture/overview.md` 清扫段、`docs/adr/` 新增 ADR-0012、`CONTEXT.md` 术语表。
- 无运行时依赖变化，无 settings/catalog 格式变化，无命令行界面变化。

## Doc Impact

- `docs/prd.md`：none——不改变产品定位、目标与非目标；清扫处置策略属于行为契约与实现层。
- `docs/architecture/overview.md`：同步 instance 清扫的处置策略描述（分流判据与去向）。
- `CONTEXT.md`：内部术语表新增「收养」条目（spec、design 与架构文档引用该术语）。
- `docs/adr/`：新增 ADR-0012，说明带扫描守门的条件收养为何不构成对 ADR-0010「回收时吸收」否决的推翻；ADR-0010 的其余决定原样保留，不改写。
