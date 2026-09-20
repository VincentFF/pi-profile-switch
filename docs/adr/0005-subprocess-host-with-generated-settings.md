# 子进程宿主与生成式 settings

取代 ADR-0001。项目级资源的处置改由 [ADR-0011](0011-project-scope-belongs-to-pi.md) 决定。

## 背景

资源过滤必须发生在第一个 agent turn 之前：向模型暴露全量资源再收回是不可接受的。

ADR-0001 断言 Pi 没有 pre-start 过滤接缝，据此选择由 pi-profile 用 Pi SDK 自行构建 runtime。针对 Pi 0.85.1 的验证推翻了该前提：接缝存在，只是不在 Extension API 里。四项事实被逐条验证：

- settings 的资源数组支持排除 pattern 与附加绝对路径，可在 Pi 的自动发现之上做白名单。
- 项目级自动发现可被 `defaultProjectTrust: "never"` 完全抑制，再由附加绝对路径恢复选中项。
- `PI_CODING_AGENT_DIR` 可把 Pi 指向 pi-profile 自有的 settings 目录，session 文件仍留在真实位置。
- `ctx.reload()` 重读磁盘上的 settings 并重建 runtime，session 的 sessionId、session 文件与消息历史均保持不变。

## 决策

`pi-profile` 以子进程方式启动真实 `pi` 二进制，用户参数原样透传，并为其生成一个 profile 专属 agent 目录，其中 `settings.json` 编码该 profile 的资源选择。pi 内的 pi-profile extension 通过重写该文件并调用 `ctx.reload()` 完成会话内切换。

用户配置文件从不被修改。

## 被否方案

**ADR-0001 的 SDK 宿主方案**：由 launcher 用 Pi SDK 自行构建 runtime，把已过滤的资源图交给 ResourceLoader。否掉的理由是前提不成立——过滤接缝存在，只是不在 Extension API 里（见背景）。此外 SDK 宿主还要重新实现 Pi 的启动行为：模式、changelog、更新、session 恢复。

## 代价

- 耦合从 SDK 宿主 API 转移到 Pi 的 settings schema、pattern 语义、环境变量与 reload 行为。集成测试用真实 Pi 子进程守卫这些漂移。
- `pi install` 与 `pi config` 在会话内写生成的 settings，退出后丢失；持久改动需走 `/profile edit` 或原生 `pi`。
- launcher 需要拦截两个输入：位置 profile 名与 `--approve`（后者被重新解释为 trust 输入，防止 Pi 侧自动发现未过滤的项目资源）。
