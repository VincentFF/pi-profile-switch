# Spec Delta

## ADDED Requirements

### Requirement: 安装分发 profile-config skill

安装包时，系统 SHALL 把随包的 `profile-config` skill 写入用户 agentDir 的 `skills/profile-config/` 目录。该 skill 指导 agent 创建、修改与删除 profile 文件。

该 skill 是普通用户级资源：系统 MUST NOT 为它引入过滤豁免或运行时特判；命名 profile 只在声明引用它时才包含它。

升级安装时 SHALL 始终覆写该 skill 的内容，使其与包版本一致。分发失败 MUST NOT 使安装失败。

#### Scenario: 首次安装

- **WHEN** 用户 agentDir 的 `skills/` 下尚不存在 `profile-config`
- **THEN** 安装写入随包的 skill 文件

#### Scenario: 升级覆写

- **WHEN** 用户 agentDir 的 `skills/profile-config/` 已存在，且内容与随包版本不同
- **THEN** 安装以随包版本覆写

#### Scenario: 分发失败降级为警告

- **WHEN** 写入 skill 文件失败（如目标目录不可写）
- **THEN** 安装降级为警告继续，安装本身不失败
