# Proposal

## Why

starter profile（`ask`）与 `profile-config` skill 的分发完全依赖 npm `postinstall` 钩子。npm v12 起，依赖的生命周期脚本默认被拦截（`allowScripts` 未放行即不执行，仅打印一条 warning），用户安装后两个产物都缺失，且无任何报错指向原因。只要分发依赖「安装时自动执行代码」，执行就不受我们控制。分发保证必须移到运行时：launcher 是每个会话的必经入口，启动时补齐产物即可保证「首次使用前一定就位」。

## What Changes

- 新增运行时 ensure：launcher（`pi-profile`）每次启动时、解析初始 profile 之前，执行与 postinstall 同规则的补齐逻辑——
  - 全局 `profiles/` 目录中无任何 `.json` 文件时写入随包 starter profile `ask.json`（不覆盖既有文件）；
  - 用户 agentDir 的 `skills/profile-config/SKILL.md` 内容与随包版本不一致时覆写为随包版本。
- ensure 失败降级为 stderr 警告，MUST NOT 阻塞启动（与 instance 清扫的 best-effort 模式一致）。
- `bin/postinstall.js` 保留，角色从唯一分发渠道降级为 best-effort 的提前优化；行为规则不变。
- 无新增用户可见配置字段：ensure 的触发时机与落点全部由既有发现机制（`PI_PROFILE_SWITCH_DIR`、Pi 的 `getAgentDir()`）决定，无可配置项。
- 无 breaking change：安装期行为不变，仅新增运行时补齐。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `profile-catalog`：修改「安装播种 starter profile」与「安装分发 profile-config skill」两个 requirement——触发时机从仅安装时扩展为「安装时 best-effort + launcher 启动时保证」，失败语义从「不使安装失败」扩展为「不使安装或启动失败」。

## Impact

- 代码：新增 `src/starter-assets.ts`（ensure 逻辑与导出面）；`bin/pi-profile.ts`（启动流程中调用）；`bin/postinstall.js`（文件头注释更新角色定位，逻辑不变）。
- 测试：新增 starter-assets 单测；postinstall 既有用例保持通过。
- 文档：`README.md` 与 `README.zh-CN.md` 的安装段（skill 分发的「on install」表述）；`docs/architecture/overview.md` 的 `bin/` 表行与新模块说明。
- 排序假设：本 change 的 specs delta 修改「安装分发 profile-config skill」，该 requirement 由未归档的 `openspec/changes/profile-config-skill/` 引入。本 change 进入 apply 前，`profile-config-skill` 应先归档（sync 进主 spec），否则 delta 缺少 base。

## Doc Impact

- `docs/prd.md`：none——分发时机调整不改变产品定位与非目标。
- `docs/architecture/overview.md`：`bin/` 表行中 postinstall 的角色描述；新增 `src/starter-assets.ts` 模块说明。
- `CONTEXT.md`：none——无新术语；沿用既有「播种」与「分发」表述。
- `docs/adr/`：none——决策可逆（恢复纯 postinstall 分发只需删除运行时调用），无外部依赖锁定。已否方案记录于此：改为 shell 脚本分发（npm 拦截发生在 lifecycle hook 层，与脚本语言无关，且牺牲 Windows 可移植性）；文档化 `--allow-scripts` 让用户放行（把保证推给用户动作，等于没有保证）；extension `session_start` 双保险（extension 在 launcher 之外直接早退，launcher 已是唯一入口，双写点徒增发散风险）。
