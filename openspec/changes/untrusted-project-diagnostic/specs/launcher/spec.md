# Spec Delta

## MODIFIED Requirements

### Requirement: 启动诊断输出

启动器 SHALL 把非致命的诊断信息输出到 stderr 并继续启动：extension 发现的警告、解析阶段零匹配的 glob 引用，以及未受信任项目提示。

项目信任判定为未受信任，且项目目录中存在因不信任而不可用的内容——pi-profile 的项目文件或任何需要信任的 Pi 项目资源——时，启动器 SHALL 输出一条诊断，说明项目未受信任、哪些内容因此不可见、以及如何授权：`/trust` 持久保存信任决定（下次启动生效），`-- --approve` 本次一次性信任。该诊断 SHALL 对所有 profile 一致，包括 `default`。启动 SHALL 照常继续，退出码不变。

项目受信任，或未受信任但项目不含任何需要信任的内容时，SHALL NOT 输出该诊断。

#### Scenario: 零匹配 glob

- **WHEN** profile 的某个 glob 引用本次解析零匹配
- **THEN** 启动继续，stderr 输出一条指明该引用零匹配的警告

#### Scenario: 未受信任项目存在被跳过的内容

- **WHEN** 项目未受信任，且项目目录下存在 `.pi/profiles.json` 或 `.pi/extensions` 等需要信任的内容
- **THEN** 启动继续、退出码不变，stderr 输出一条诊断，说明项目未受信任、不可见的内容与授权方式（`/trust` 与 `-- --approve`）

#### Scenario: 受信任项目无诊断

- **WHEN** 项目已受信任
- **THEN** 不输出未受信任项目诊断

#### Scenario: 未受信任但无需要信任的内容

- **WHEN** 以 `--no-approve` 启动，且项目目录不含任何需要信任的资源与 pi-profile 项目文件
- **THEN** 不输出未受信任项目诊断
