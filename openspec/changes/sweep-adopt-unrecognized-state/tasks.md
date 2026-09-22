# Tasks

## 1. 清扫分流实现

- [x] 1.1 在 `src/launcher/runtime-cleanup.ts` 中为未识别条目实现内容扫描谓词：读取条目字节内容（目录递归全部成员，设体积/数量上限常量，超限视为无法判定）搜索所在 instance 目录的绝对路径；验证：新增单元测试覆盖"内容含 instance 路径 → 判定为保留"与"目录超限 → 判定为保留"
- [x] 1.2 将 `unrecognizedEntries` 改为按条目产出处置决定（adopt / delete / keep-warn），`sweepEntry` 执行：扫描阴性且真实 agentDir 无同名条目 → rename 搬入真实 agentDir 并输出 notice；已有同名条目 → 删除 instance 副本（不比较内容）并输出 notice；其余 → 保留并输出原有警告；存在保留条目时目录整体保留，否则回收。`extensions/` 内部条目只走警告分支；验证：`npm test` 通过
- [x] 1.3 为 `test/launcher.integration.test.ts` 补充 delta spec 中四个新 scenario 的集成测试（路径引用保留并告警、无冲突收养、同名冲突删除且 notice、`extensions/` 内部只告警）；验证：`npm test` 中新用例通过

## 2. 校验

- [x] 2.1 运行 `npm run check` 与 `npm test`，全部通过

## 3. 文档同步

- [x] 3.1 新增 `docs/adr/0012-conditional-sweep-adoption.md`：记录带扫描守门的条件收养与 real wins 冲突删除，说明其为何不构成对 ADR-0010「回收时吸收」否决的推翻；验证：文件存在且按 ADR 编号规范引用 ADR-0010
- [x] 3.2 更新 `docs/architecture/overview.md` 的 instance 清扫段，同步分流判据与去向（链接 ADR-0012，不重抄论证）；验证：该段描述与 `openspec/specs/launcher/spec.md`（归档后）一致
- [x] 3.3 在 `CONTEXT.md` 内部术语表新增「收养」条目；验证：术语表包含该条目且无规避词
