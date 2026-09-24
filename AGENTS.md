# pi-profile-switch

pi-profile-switch 是给 Pi 加命名 profile 的 Pi package。一个 profile 引用既有的 skills、extensions、MCP servers 与 tools，并可在同一个 Pi 会话内切换。产品意图、设计原则与非目标见 `docs/prd.md`。

## 进场先读

按任务读，不要一次全读。

| 你要做的事 | 先读 |
| --- | --- |
| 改行为、命令或配置语义 | `docs/prd.md` 的「非目标」段，再读 `openspec/specs/` 对应能力域 |
| 改模块边界、生成物或激活流程 | `docs/architecture/overview.md` |
| 想提出一个更顺手的方案 | `docs/adr/`；该方案很可能已被否掉 |
| 起新变更 | `openspec/config.yaml` 的 `context` 段 |
| 改主 spec 的 `## Purpose` | `docs/prd.md`；与定位重复时改为链接 |

术语以 `CONTEXT.md` 为准，其中标注的规避词不得使用。

## 操作约束

### Pi 兼容优先

- 改动前确认它不影响未被 profile 声明控制的行为。Pi 的 settings、资源发现与会话行为必须保持原样。
- 不引入 Pi 没有的概念。扩展依赖图、常驻扩展、资源副本都属于此类。
- profile 未声明的字段不得产生任何副作用。

### 极简

- 新增用户可见配置字段前，先证明它不能由发现机制或默认值替代。
- 新增命令前，先确认现有命令族里没有合适位置，且不占用其他 Pi package 的命名空间。
- 错误必须可行动：给出候选、相近名或修复方式，不静默失败。

### 文档

- 事实归属判据与能力域在 `openspec/config.yaml` 的 `context` 段，不要在别处重复。
- 一个事实只写一次；需要引用别处的事实时写链接，不重抄。
- 不改写既有 ADR 的决定。决策变化时新增编号文件，并在旧文件顶部加一行 `**Superseded by ADR-XXXX.**`。
- 新增 ADR 用 `docs/adr/` 中下一个可用编号，不复用旧编号。
- ADR 用编号引用，如 `ADR-0005`。文件链接用仓库相对路径。

### 代码

- TypeScript ESM，import 带 `.ts` 扩展名，跟随现有文件的写法。
- 不新增运行时依赖，除非现有依赖无法完成。
- 改动后运行 `npm run check` 与 `npm test`。
- 提交信息用 conventional commits，一次提交只做一件事。

## 变更流程

会改变可观察行为、规范内容或决策的改动走 OpenSpec，不直接改代码或文档：

```text
/opsx-explore → /opsx-propose → /opsx-apply → /opsx-verify → /opsx-archive
```

辅助流程为 `/opsx-sync`、`/opsx-update`，定义见 `.pi/prompts/opsx-*.md`。artifact 规则与归档门禁在 `openspec/config.yaml` 的 `rules` 与 `operations` 段。

不改变上述任何一项的修正直接提交，不必开 change：增删文档文件、修链接与错字、改注释与用例名、重命名纯调整文件。判据是它会不会改变读者对行为的理解：会，就走流程。

### 流程纪律与升舱规则

- **完成即归档**：起新 change 或进入 apply 前，运行 `openspec list`；若存在任务已全部勾选但未归档的 change，必须先执行归档，避免下游变更因 delta 缺少 base 产生依赖链锁开销与校验噪音。
- **指令调用去重**：同一 change 同一 artifact 的 `openspec instructions` 在主会话中只调用一次，后续引用首次输出，避免重复拉取全量规则模板造成上下文膨胀。
- **关键路径与 team-workflow 升舱**：team-workflow 的通用升舱规则见 `team-workflow` skill。本项目中凡触及以下每会话必经路径的改动，apply 必须升舱走 team-workflow：
  - launcher 启动流程与时序（`bin/pi-profile.ts`、`src/launcher/`）
  - instance 运行时目录生成与清扫（`src/settings-generator.ts`、`src/launcher/runtime-cleanup.ts`）
  - 资源发现与过滤模型（`src/profile-resolver.ts`、`src/skill-registry.ts`、`src/extension-discovery.ts`）
