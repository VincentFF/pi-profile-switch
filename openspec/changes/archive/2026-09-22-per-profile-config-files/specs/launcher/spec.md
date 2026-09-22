# Spec Delta

## MODIFIED Requirements

### Requirement: 项目信任守门

项目范围中由 pi-profile 自己读取的内容——项目 catalog、项目运行时状态、项目 MCP 配置——SHALL 只在项目已受信任时才被读取。

项目级资源（`.pi/skills`、`.pi/extensions`、ancestor `.agents/skills`、`.pi/prompts`、`.pi/themes`、`.pi/settings.json`）的可见性 SHALL 由 Pi 自己按项目信任判定决定。pi-profile MUST NOT 通过 Generated settings 收窄、附加或排除这些资源。

信任判定 SHALL 按以下顺序取第一个成立的结果：一次性的 `--approve` 或 `--no-approve` 输入；项目不含任何需要信任的资源时视为受信任；真实 `trust.json` 中最近祖先的已存储决定；用户的全局 `defaultProjectTrust` 设置为 `always`；否则不受信任。

需要信任的项目资源 SHALL 包括 pi-profile 自己的项目文件 `<projectDir>/.pi/profiles/` 与 `<projectDir>/.pi/pi-profile-state.json`。

信任判定 MUST NOT 执行任何 extension 代码。

启动器记录的信任 flag SHALL 重新附加给被启动的 Pi 进程，且 SHALL 对所有 profile 一致：一次性信任输入在任何 profile 下都 SHALL 同时决定项目 catalog 的可读性与 Pi 的项目级可见性，MUST NOT 出现两者分歧。

#### Scenario: 一次性信任输入优先于已存储决定

- **WHEN** `trust.json` 对当前项目记录了不受信任，而本次启动带 `--approve`
- **THEN** 项目资源在本次启动可读

#### Scenario: 命名 profile 同样转发信任 flag

- **WHEN** 以 `pi-profile doc -- --no-approve` 启动
- **THEN** Pi 进程收到 `--no-approve`，且该 flag 不出现在用户参数中

#### Scenario: 项目的 defaultProjectTrust 为 ask

- **WHEN** 用户全局设置为 `ask`，且 `trust.json` 无当前项目的记录
- **THEN** 项目 catalog 与项目运行时状态都不被读取，命名 profile 的项目级资源也不可见

#### Scenario: 只存在 pi-profile 的项目文件

- **WHEN** 项目目录下只有 `.pi/profiles/` 目录而没有 Pi 认识的项目资源
- **THEN** 该项目仍被判定为含需要信任的资源，不因"没有项目资源"而自动受信任
