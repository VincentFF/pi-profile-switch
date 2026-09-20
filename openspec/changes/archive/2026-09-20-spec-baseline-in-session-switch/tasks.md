# Tasks

本变更不产出代码。每个任务是把规范逐条对回实现，确认没有写出未实现的行为，也没有漏掉已实现的行为。

## 1. 规范与实现一致性核对

- [x] 1.1 核对「/profile 命令族与模式门禁」：读 `extensions/pi-profile/index.ts` 的命令分派段，确认子命令集合、三处用法拒绝、以及 `ctx.mode !== "tui"` 的门禁只覆盖四个 CRUD 子命令
- [x] 1.2 核对「会话内切换」：读 `src/switching/switch-profile.ts` 的 `switchProfile`，确认六步时序、`waitForIdle` 的位置、解析失败时不写文件、`/profile use` 的 `clearOverlay` 与持久化、以及 `/profile reload` 保持既有持久性
- [x] 1.3 核对「切换失败回滚」：读 `src/switching/switch-profile.ts` 的 `snapshotFile`、`restoreFile`、`rollback` 与 `assertStale` 探针，确认三类快照的精确还原、先 `rm` 再还原的原因、以及静默 reload 也回滚
- [x] 1.4 核对「session start 的 plan 应用与变更摘要」：读 `src/switching/apply-plan.ts`，确认 tool 重新展开与 `droppedLiterals` 警告、`reason === "reload"` 的持久化条件、`switchedFrom` 摘要的一次性、以及 `clearOverlay` 对 overlay 的删除
- [x] 1.5 核对「Runtime overlay」：读 `src/switching/customize.ts` 的 `customizeOverlay`、`resetOverlay`、`parseCustomizeArgs` 与 `src/profile-resolver.ts` 的 overlay 收窄段，确认写入顺序两条不变式、禁用未知资源的三处报错、以及 `default` profile 的 MCP 禁用拒绝
- [x] 1.6 核对「运行时状态」：读 `src/runtime-state-store.ts`，确认 state 目录的两种构造、`update` 的读改写合并语义、以及损坏文件读作空状态
- [x] 1.7 核对「观测面」：读 `src/switching/list-profiles.ts` 与 `extensions/pi-profile/index.ts` 的 list/status/裸调用分支，确认信任门控、`shadowsGlobal` 标注、无 UI 时退化为列表、以及两处 `sendMessage` 的结构化 `details`
- [x] 1.8 核对「CRUD 对运行时的影响」：读 `extensions/pi-profile/index.ts` 的 create/edit/delete/duplicate 分支，确认编辑活动 profile 立即 reload、编辑非活动 profile 不动 runtime、删除活动 profile 的替代选择与同名揭示两条路径

## 2. 规范质量校验

- [x] 2.1 运行 `openspec validate spec-baseline-in-session-switch --strict` 通过
- [x] 2.2 比对规范与 `docs/adr/0005-subprocess-host-with-generated-settings.md`，确认没有复述其被否方案与论证
- [x] 2.3 比对规范与 `docs/architecture/overview.md` 的「激活流程」「模块与接口」两段，确认规范不重复机制描述，且未出现 plan 文件的内部字段名
- [x] 2.4 核对规范与 `spec-baseline-profile-catalog` 的写入语义没有重复：失败条件与 scope 归属应只出现在 catalog 规范中
- [x] 2.5 核对用词与 `CONTEXT.md` 一致，确认未使用规避词，且未出现实现类名

## 3. Doc Impact 落地

- [x] 3.1 核对 `docs/prd.md`：确认本次没有改变定位、目标或非目标，无需改动
- [x] 3.2 核对 `docs/architecture/overview.md`：确认本次没有改变模块边界、数据流或已知限制，无需改动
- [x] 3.3 核对 `CONTEXT.md`：确认没有引入新术语或改变既有术语含义，无需改动
- [x] 3.4 核对 `docs/adr/`：确认没有引入难以撤销的决策，无需新增 ADR
