# Tasks

## 1. instance 生成改为 per-launch

- [x] 1.1 `src/settings-generator.ts` 的 `generateRuntimeDir` 改为在 instance 根下创建唯一目录（`launch-` 前缀，随机标识），返回的 `runtimeDir` 即交给 Pi 的 agentDir；验证：`test/settings-generator.test.ts` 的路径用例改为断言目录位于 instance 根下、且两次生成的路径不同，`npm test` 通过
- [x] 1.2 `src/settings-generator.ts` 在镜像前 seed 真实 agentDir 的 `missions` 目录（缺失时 `mkdir`，已存在时不动，不写入内容）；验证：新增用例断言首次生成后真实 agentDir 下出现该目录、instance 内是指向它的软链，第二次生成后目录内容不变
- [x] 1.3 `bin/pi-profile.ts` 的清扫调用改为在生成本次 instance 之前针对 instance 根执行；验证：手动启动一次后 `instances/` 下只保留本次的 `launch-*` 目录
- [x] 1.4 核对 `src/workspace.ts` 的 `getInstancesRootDir` 与注释仍与 per-launch 语义一致，确认无需改动；验证：`npm run check` 通过

## 2. 清扫与未识别条目保护

- [x] 2.1 `src/launcher/runtime-cleanup.ts` 的清扫根改为 `<PI_PROFILE_SWITCH_DIR>/instances`，只处理 `launch-` 前缀目录；验证：`test/runtime-cleanup.test.ts` 覆盖 pid 存活保留、pid 已退出回收、无 pid 且超宽限期回收、无 pid 且在宽限期内保留四种判定
- [x] 2.2 实现未识别条目判定（既不是符号链接，也不是受管生成物，含受管目录内部的条目）；命中时保留目录并把警告（点名目录、条目、可处置方式）交给调用方输出到 stderr；验证：新增用例断言含野生目录的 instance 不被删除且产生警告
- [x] 2.3 回归：判定 MUST NOT 使用"真实 agentDir 已有同名条目"作为可删除条件；验证：新增用例在真实 agentDir 已存在 `missions` 的情况下，断言含同名真实目录的 instance 仍被保留
- [x] 2.4 边界：instance 根下非 `launch-` 形态的目录不被删除也不影响本次启动；验证：新增用例放入一个其他形态目录，断言清扫后它仍存在
- [x] 2.5 清扫尽力而为：单个目录出错不中断其余目录与本次启动；验证：新增用例让一个目录不可读，断言其余死目录仍被回收、函数不抛错
- [x] 2.6 核对 `src/launcher/spawn.ts` 未新增退出时删除逻辑；验证：读该文件确认 `finally` 分支只移除信号处理器

## 3. 测试与集成

- [x] 3.1 `test/settings-generator.test.ts`、`test/project-scope.integration.test.ts`、`test/mcp.integration.test.ts` 中硬编码 `instances/<profile>/agent` 的断言改为在 `PI_PROFILE_SWITCH_DIR` 下发现本次唯一的 `launch-*` 目录；验证：`npm test` 通过
- [x] 3.2 集成验证并发语义：同一 profile 两次启动使用不同 instance 路径；验证：新增集成用例断言两次启动的 `PI_CODING_AGENT_DIR` 不同且各自文件不被对方改写
- [x] 3.3 全量校验；验证：`npm run check` 与 `npm test` 全绿

## 4. Doc Impact 落地

- [ ] 4.1 改写 `docs/architecture/overview.md` 的「运行目录」整段：路径形态改为每次启动唯一目录、`pid` 位置、seed 规则、清扫规则，并同步受管文件表
- [ ] 4.2 改写 `docs/architecture/overview.md` 的「已知限制」：删除"instance 路径固定导致并发互相重写""已删除或改名 profile 的 instance 目录不被清理"两处，新增一行"0.4.x 遗留 instance 目录不被新清扫触及，需用户自行处置"
- [ ] 4.3 在 `docs/architecture/overview.md` 增补 seed 名单小表（当前仅 `missions`），并注明"加条目必须有观察证据，不能靠推断"
- [x] 4.4 新增 `docs/adr/0010-per-launch-instance-lifecycle.md`（已随本变更落盘）；验证：其决策与 `design.md` 一致，apply 阶段若有设计修订需同步更新该文件
- [ ] 4.5 核对 `docs/prd.md` 与 `CONTEXT.md` 确实无需改动（`instance` 定义已描述 per-launch）；验证：`git diff --stat` 显示这两个文件未被触碰
- [ ] 4.6 运行 `openspec validate per-launch-instance-lifecycle --strict` 通过

## 5. 本变更范围外

- 0.4.x 的 `instances/<profile>/agent` 与 0.1–0.3 的 `<agentDir>/pi-profile/runtime/launch-*` 不迁移、不清理，也不做兼容清扫。
- 受管目录内部的第三方状态（如 `extensions/subagent/config.json`）不做内层 seed；`chains` 等未经观察的第三方状态目录不进 seed 名单，出现未识别条目时由 2.2 的警告点名。
- 退出时删除 instance 目录不在本变更内；回收只由启动清扫承担。
