# Design

## Context

动机见 proposal.md 的「Why」。塑造方案的当前状态与约束：

- `bin/postinstall.js` 必须是纯 Node ESM（npm postinstall 环境限制，文件头有注明），其中 agentDir 解析镜像 Pi 的 `getAgentDir()`，遵循「keep in sync」注释约定。
- launcher `bin/pi-profile.ts` 直接 import Pi 的 `getAgentDir()` 与本包的 `getGlobalProfilesDir()`，运行时无需镜像。
- extension（`extensions/pi-profile/index.ts`）在 `PI_CODING_AGENT_DIR` 缺失时直接早退——launcher 是每个会话的唯一入口，instance 在 launcher 内生成。
- 随包资产 `examples/ask.json` 与 `skills/profile-config/SKILL.md` 均在 `package.json` 的 `files` 中，发布包与开发仓库都可用。

## Goals / Non-Goals

**Goals:**

- 分发保证：只要用户经 launcher 启动一次，starter profile 与 `profile-config` skill 必就位（规则同 postinstall）。
- 单一 TS 实现，幂等，开销限于 stat/内容比较；失败永不阻塞启动。

**Non-Goals:**

- 不删除 postinstall（降级为提前优化，见 Decisions）。
- 不在 extension `session_start` 加第二个 ensure 点。
- 不做卸载清理（沿用既有「卸载后可能残留，接受不清理」的立场）。
- 不新增用户可见配置字段。

## Decisions

### D1：新增 `src/starter-assets.ts`，导出面

```ts
export interface StarterAssetFileResult {
	/** 目标文件绝对路径 */
	path: string;
	/** 本次调用是否发生了写入 */
	written: boolean;
}

export interface StarterAssetsResult {
	profile: StarterAssetFileResult;
	skill: StarterAssetFileResult;
	/** 人类可读的降级警告；为空表示全部成功或无操作 */
	warnings: string[];
}

export async function ensureStarterAssets(options?: {
	/** 默认 getGlobalProfilesDir()；测试注入 */
	globalProfilesDir?: string;
	/** 默认 Pi 的 getAgentDir()；测试注入 */
	agentDir?: string;
	/** 默认由 import.meta.url 定位包根；测试注入 */
	packageRoot?: string;
}): Promise<StarterAssetsResult>;
```

- 不新增错误类型：IO 失败（`NodeJS.ErrnoException`）内部捕获，转为 `warnings` 条目；函数对所有可预期的运行环境失败不抛出。
- 两个资产独立成败：一个失败不影响另一个的尝试。

### D2：launcher 在解析初始 profile 之前调用 ensure

`bin/pi-profile.ts` 中，`parseLauncherArgs` 之后、`resolveInitialProfile` 之前调用 `ensureStarterAssets()`，`warnings` 经 `console.error` 以 `pi-profile: warning:` 前缀打印（与 instance 清扫的 best-effort 输出模式一致）。此时序使播种的 `ask` 对本次启动的初始解析与 `/profile list` 可见。

### D3：资产定位用 `import.meta.url` 相对包根

`src/starter-assets.ts` 位于 `src/` 下一级，资产路径为 `../examples/ask.json` 与 `../skills/profile-config/SKILL.md`。不读 `package.json` 定位，与 postinstall 的 `new URL("../examples/ask.json", import.meta.url)` 一致。

### D4：运行时用 Pi 的 `getAgentDir()`，不再镜像

postinstall 的镜像实现仅因纯 JS 约束保留；TS 运行时直接复用 launcher 已 import 的 `getAgentDir()`，消除一处漂移源。

### D5：postinstall 保留为 best-effort 提前优化

放行 `allowScripts` 的用户在安装期即就位，未放行的用户由 launcher 兜底。postinstall 逻辑不变，仅更新文件头注释中的角色定位（权威行为契约指向 `openspec/specs/profile-catalog/spec.md` 的对应 requirement）。两份实现延续既有「keep in sync」约定。

### D6：skill 同步先比较内容，不同才覆写

每次启动覆写会产生无谓的磁盘写与 mtime churn；内容一致时跳过。可观察结果与「始终覆写」等价：任何一次启动后内容与随包版本一致。

### 已否方案

见 proposal.md 的 Doc Impact 段（shell 脚本、`--allow-scripts` 文档化、extension 双保险），不重复论证。

## Risks / Trade-offs

- 用户删光全部 profile 后，下次启动重新播种 `ask.json` → 与安装语义一致（空目录视为 fresh start），spec 的「启动时不覆盖」scenario 界定了仅在完全无 profile 时才播种。
- 并发 launcher 启动竞态 → 播种沿用 `COPYFILE_EXCL`（败方静默）；skill 覆写目标内容相同，最后写入者胜出，结果一致。
- postinstall 与运行时两份逻辑漂移 → 「keep in sync」约定 + 行为契约唯一归属 spec；测试对两侧各设镜像用例。
- ensure 在每次启动增加两次 stat/一次可能的内容读取 → 开销可忽略；内容比较仅在 skill 文件存在时发生。

## Migration Plan

无迁移步骤：安装期行为不变，存量用户下次 `pi-profile` 启动自动补齐缺失产物。回滚 = 移除 launcher 中的调用。
