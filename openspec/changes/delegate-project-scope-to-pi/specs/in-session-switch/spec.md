# Spec Delta

## MODIFIED Requirements

### Requirement: 会话内切换

`/profile use <name>` SHALL 依次执行：等待当前 agent turn 结束、快照运行时文件、按完整启动路径重新解析目标 profile、就地重写运行时文件、触发 Pi 的原生 reload。

等待 SHALL 使用 Pi 原生的空闲等待，MUST NOT 打断正在进行的 turn。

重新解析 SHALL 包含与启动路径相同的校验：信任判定、catalog 读取、资源发现、模型与 MCP 校验。解析失败时 SHALL NOT 写入任何运行时文件，运行时保持切换前的状态。

切换 SHALL NOT 重启 Pi 进程；当前 session 的 sessionId 与消息历史 SHALL 保持不变。

切换 SHALL NOT 改变 Pi 的项目信任输入：instance 的 `trust.json` 链接形态在切换前后相同，项目级资源的可见性因此在同一进程内保持稳定。切换后的项目级可见性 SHALL 与直接以目标 profile 启动一致，MUST NOT 需要重启进程才生效。

`/profile use` SHALL 保存该选择，并 SHALL 丢弃切换前 profile 的 overlay。

`/profile reload` SHALL 走同一路径，但 SHALL NOT 产生变更摘要，并 SHALL 保持当前 profile 既有的选择持久性不变（启动时的一次性选择在 reload 后仍是一次性的）。

#### Scenario: 切换成功

- **WHEN** 执行 `/profile use implement`，且解析与 reload 都成功
- **THEN** 运行时文件被重写为该 profile 的解析结果，session 未中断

#### Scenario: 项目级可见性不因切换而改变

- **WHEN** 项目已受信任，以命名 profile 启动后执行 `/profile use default`
- **THEN** 项目级 skill 与 extension 在两个 profile 下都可见，进程未重启，sessionId 与消息历史不变

#### Scenario: 解析阶段失败

- **WHEN** 目标 profile 的引用无法解析
- **THEN** 操作失败并报告原因，运行时文件未被改动

#### Scenario: reload 保持一次性选择

- **WHEN** 以 `pi-profile review` 启动（一次性选择），随后执行 `/profile reload`
- **THEN** 仍运行 `review`，且该选择不因此被写入运行时状态
