# Tasks

## 1. 前置排序

- [x] 1.1 归档 `profile-config-skill`（`/opsx-archive`），使「安装分发 profile-config skill」进入主 spec `openspec/specs/profile-catalog/spec.md`。验证：归档后运行 `openspec validate runtime-ensure-starter-assets`，不再出现「RENAMED failed … source not found」的 INFO 提示

## 2. 运行时 ensure 模块

- [x] 2.1 新增 `src/starter-assets.ts`：按 design.md D1 导出面实现 `ensureStarterAssets()`。播种规则：目标目录无任何 `.json` 时以 `COPYFILE_EXCL` 语义写入 starter profile；skill 规则：目标缺失或内容不同才覆写，一致则不写；两个资产独立成败，IO 失败转为 `warnings` 不抛出。验证：覆盖 specs delta「播种 starter profile」的「启动时补齐」「启动时不覆盖」「启动时播种失败降级为警告」与「分发 profile-config skill」的「启动时补齐或同步」「启动时内容已一致」「启动时分发失败降级为警告」六个 scenario；`npx vitest run test/starter-assets.test.ts` 通过。事实 → 权威来源：资产相对路径 `examples/ask.json`、`skills/profile-config/SKILL.md` → 仓库内实际文件与 `package.json` 的 `files` 数组；agentDir 默认解析 → `@earendil-works/pi-coding-agent` 导出的 `getAgentDir()`（`node_modules/@earendil-works/pi-coding-agent` 源码）
- [x] 2.2 `bin/pi-profile.ts`：在 `parseLauncherArgs` 之后、`resolveInitialProfile` 之前调用 `ensureStarterAssets()`，`warnings` 经 `console.error` 打印且启动继续。验证：覆盖「启动时补齐」scenario 的端到端可见性（播种结果对初始 profile 解析可见）；`npx vitest run test/launcher.integration.test.ts` 通过。事实 → 权威来源：警告输出前缀 `pi-profile: warning:` → `bin/pi-profile.ts` 既有 sweep 警告输出写法

## 3. postinstall 角色更新

- [x] 3.1 `bin/postinstall.js`：仅更新文件头注释——角色从唯一分发渠道改为 best-effort 提前优化，权威行为契约指向 `openspec/specs/profile-catalog/spec.md` 的「播种 starter profile」「分发 profile-config skill」；分发逻辑不变。验证：`npx vitest run test/postinstall.test.ts` 既有用例（覆盖「首次安装」「已有 catalog」「升级覆写」「分发失败降级为警告」scenario）全部通过

## 4. 文档同步

- [x] 4.1 `README.md` 与 `README.zh-CN.md`：把 `profile-config` skill 的「distributed on install」表述改为「安装时 best-effort 分发，launcher 启动时保证就位」。验证：grep 两份 README 不再含仅归因于 install 的分发表述。事实 → 权威来源：分发时机语义 → 本 change 的 specs delta
- [x] 4.2 `docs/architecture/overview.md`：更新 `bin/` 表行中 `postinstall.js` 的角色描述；在 `src/` 模块表中新增 `starter-assets.ts` 行。验证：表中描述与 design.md D1/D5 一致，且不复述 spec 行为契约（写链接）。事实 → 权威来源：模块导出面 → design.md D1

## 5. 回归

- [x] 5.1 `npm run check` 与 `npm test` 全部通过。验证：两条命令退出码为 0
