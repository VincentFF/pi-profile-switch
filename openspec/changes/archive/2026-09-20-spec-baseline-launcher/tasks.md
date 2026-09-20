# Tasks

本变更不产出代码。每个任务是把规范逐条对回实现，确认没有写出未实现的行为，也没有漏掉已实现的行为。

## 1. 规范与实现一致性核对

- [x] 1.1 核对「CLI 参数解析与透传」：读 `src/launcher/args.ts`，确认只消费一个前导位置参数与至多一个 `--`、四个信任 flag 的识别与 last-wins、其余原样透传
- [x] 1.2 核对「初始 profile 选择」：读 `src/launcher/initial-profile.ts` 的 `resolveInitialProfile`，确认三级回退顺序、`UnknownProfileError` 的硬失败条件、保存选择失效时的软回退与警告、以及不写运行时状态
- [x] 1.3 核对「启动前失败与退出码」：读 `bin/pi-profile.ts` 的 catch 分支，确认六类 usage error 的清单与退出码 `2`/`1` 的划分
- [x] 1.4 核对「项目信任守门」：读 `src/project-trust.ts`，确认判定顺序四步、`hasPiProfileProjectFiles` 的纳入、以及不执行 extension 代码
- [x] 1.5 核对「启动诊断输出」：读 `src/launcher/initial-profile.ts` 的 `unmatchedWarnings` 与 `bin/pi-profile.ts` 的警告输出，确认两类诊断都写 stderr 且不阻塞
- [x] 1.6 核对「instance 目录契约」：读 `src/settings-generator.ts` 的 `generateRuntimeDir`、`writeRuntimeFiles` 与 `syncAgentSymlinks`，确认路径构造、受管文件清单、镜像与断链清理、`trust.json` 的 filter 条件、以及 `PI_CODING_AGENT_SESSION_DIR` 的移除
- [x] 1.7 核对「子进程启动」：读 `src/launcher/spawn.ts` 的 `buildPiArgs` 与 `spawnPi`，确认 argv 顺序、`trustOverride` 的转发条件与退出码/信号转发

## 2. 规范质量校验

- [x] 2.1 运行 `openspec validate spec-baseline-launcher --strict` 通过
- [x] 2.2 比对规范与 `docs/adr/0005-subprocess-host-with-generated-settings.md`，确认没有复述其被否方案与论证
- [x] 2.3 比对规范与 `docs/architecture/overview.md` 的「总体结构」「运行目录」两段，确认规范不重复机制描述：作用域到 Pi 机制的映射、生成式 settings 的编码方式都不写入规范
- [x] 2.4 核对用词与 `CONTEXT.md` 一致，确认未使用规避词，且未出现实现类名与内部函数名
- [x] 2.5 确认规范全文没有把陈旧 instance 目录的清理写成契约

## 3. Doc Impact 落地

- [x] 3.1 修正 `docs/architecture/overview.md` 的「运行目录」段：删去"启动时会清扫 `pid` 已失效的陈旧目录"这一与实际不符的断言，改为陈述实际布局（instance 路径按 profile 固定并复用，不清理）
- [x] 3.2 在 `docs/architecture/overview.md` 的「已知限制」表新增一行：陈旧 instance 目录不被清理；现存清扫实现的目标路径 `<agentDir>/pi-profile/runtime/launch-*` 与 instance 路径不同，因此不生效
- [x] 3.3 核对 `docs/prd.md`：确认本次没有改变定位、目标或非目标，无需改动
- [x] 3.4 核对 `CONTEXT.md`：确认没有引入新术语或改变既有术语含义，无需改动
- [x] 3.5 核对 `docs/adr/`：确认没有引入难以撤销的决策，无需新增 ADR

## 4. 本变更范围外

陈旧 instance 清扫失效不随本变更处理：`src/launcher/runtime-cleanup.ts` 扫的是 `<agentDir>/pi-profile/runtime/launch-*`，而 instance 写在 `<PI_PROFILE_SWITCH_DIR>/instances/<profile>/agent`，因此清扫不生效，`pid` 写入也无消费者。修复或删除该模块需要一个单独的变更。本变更不改动代码。
