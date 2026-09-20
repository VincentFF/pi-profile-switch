# Tasks

## 1. trust.json 链接与信任 flag 转发

- [x] 1.1 改 `src/settings-generator.ts` 的 `writeRuntimeFiles`：`trust.json` 对每种 profile 都建立指向真实 agentDir 的链接（路径不存在时建立，目标文件不存在时同样建立），删除 `plan.filter === "none"` 判断与删除链接的分支；验证 `test/settings-generator.test.ts` 与 `test/settings-generator-selection.test.ts` 中新增用例（命名 profile 也有链接、目标缺失时仍建立 dangling 链接）通过。
- [x] 1.2 改 `bin/pi-profile.ts`：信任 flag 不再按 `plan.filter === "none"` 过滤，任何 profile 都转发已记录的一次性输入；验证 `test/project-scope.integration.test.ts` 中 `--approve` 用例（命名 profile 收到 flag 后项目级资源可见）与 `test/launcher-spawn.test.ts` 通过。
- [x] 1.3 确认链接不破坏清扫与生命周期：`trust.json` 已在受管文件集内，无需新增白名单；验证 `test/runtime-cleanup.test.ts` 与 `test/instance-lifecycle.integration.test.ts` 通过。

## 2. 停止项目级收窄

- [x] 2.1 改 `src/settings-generator.ts` 的 `buildSelectionSettings`：scope 为 project 的 skill 既不写排除项也不写附加路径；验证 `test/settings-generator-selection.test.ts` 中新增用例（项目级 skill 与 ancestor `.agents/skills` 不产生任何条目）通过。
- [x] 2.2 同函数：项目 `.pi/extensions` 下的 extension 条目不写入 Generated settings；验证同文件新增用例通过。
- [x] 2.3 删除项目 settings 合并与 `packages` 剥除：`src/launcher/initial-profile.ts` 的 `readTrustInputs` 不再读取项目 settings，`InitialProfile`/`GenerateOptions`/`RuntimeFileOptions` 去掉 `projectSettings` 字段，`bin/pi-profile.ts` 与 `src/switching/switch-profile.ts` 相应调整；验证 `test/initial-profile.test.ts`、`test/settings-generator.test.ts`、`test/switch-profile.test.ts` 更新后的用例通过，且 `rg -n "projectSettings" src/ bin/` 只余测试或零命中。
- [x] 2.4 改 `src/mcp-config.ts`：MCP 配置源标记项目来源，合并结果返回项目来源 server 集合；`src/settings-generator.ts` 的 MCP 过滤不再禁用这些 server；验证 `test/mcp-config.test.ts` 的 `projectServers` 用例与 `test/settings-generator-selection.test.ts` 的“项目来源 MCP server 不被禁用”用例通过。

## 3. 集成行为验证

- [x] 3.1 按新语义重写 `test/project-scope.integration.test.ts` 中受信任项目的断言：未选中的项目级 skill/extension 也可见，项目 `.pi/settings.json` 不再并入 Generated settings；验证该文件通过。
- [x] 3.2 在 `test/project-scope.integration.test.ts` 或 `test/switch.integration.test.ts` 新增用例：受信任项目下以命名 profile 启动后切换（`/profile use default`）不改变项目级可见性、不需要重启；验证该用例通过。
- [x] 3.3 在 `test/project-scope.integration.test.ts` 补用例：项目未受信任时项目级 skill/extension 不出现在会话中，且 `--approve` 单次运行会同时放行项目 catalog 与项目级资源；验证该用例通过。

## 4. 文档同步

- [x] 4.1 改 `docs/architecture/overview.md`：「项目级」行改为"由 Pi 原生判定，profile 不参与"、`packages（项目）` 行改为原生安装、`trust.json` 行改为每种 profile 都链接、settings 行去掉项目 settings 并入、改写「已知限制」中"项目资源的信任判定只由 launcher 执行"与"项目范围的 package skill 不可引用"两条；验证 `rg -n "抑制全部项目自动发现|命名 profile 不链接" docs/architecture/overview.md` 零命中。
- [x] 4.2 改 `docs/prd.md`：在非目标段落写入边界——profile 的隔离面是用户级资源，项目级资源由 Pi 的信任判定决定；验证该文件出现该边界条目，且机制细节仍只在架构文档里。
- [x] 4.3 新增 `docs/adr/0011-project-scope-belongs-to-pi.md`：记录决策、被否掉的替代（继续用 trust 闸门隔离、给项目级资源补排除项）与后果（profile 失去项目级控制力、项目 settings 行为键覆盖 profile 声明）；验证文件存在、编号为下一个可用编号，且 `design.md` 中标注的 "ADR required: project-scope-belongs-to-pi" 已落地。
- [x] 4.4 检查 `README.md` 与 `README.zh-CN.md` 是否声称项目级隔离能力；`rg -n -i "unselected|hide|hidden|filter|narrow|project" README.md README.zh-CN.md` 无过时描述，未改动。

## 5. 收尾

- [x] 5.1 运行 `npm run check` 与 `npm test`，全部通过。
- [x] 5.2 运行 `openspec validate delegate-project-scope-to-pi`，通过且 tasks 与 specs 一致。
