# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: 安装播种 starter profile`
  TO: `### Requirement: 播种 starter profile`
- FROM: `### Requirement: 安装分发 profile-config skill`
  TO: `### Requirement: 分发 profile-config skill`

## MODIFIED Requirements

### Requirement: 播种 starter profile

安装包时与 launcher 每次启动时，若全局 profiles 目录中尚无任何 profile 文件，系统 SHALL 写入随包提供的 starter profile 文件，其中定义一个名为 `ask` 的 profile。目录中已存在任何 profile 文件时 MUST NOT 覆盖。launcher 启动时的播种 SHALL 在解析初始 profile 之前完成，使播种结果对本次启动可见。播种失败 MUST NOT 使安装或启动失败， SHALL 降级为警告。

#### Scenario: 首次安装

- **WHEN** 全局 `profiles/` 目录不存在或其中没有任何 `.json` 文件
- **THEN** 安装写入 starter profile 文件 `ask.json`

#### Scenario: 已有 catalog

- **WHEN** 全局 `profiles/` 目录中已存在至少一个 `.json` 文件
- **THEN** 不写入新文件，安装继续

#### Scenario: 启动时补齐

- **WHEN** launcher 启动，且全局 `profiles/` 目录中没有任何 `.json` 文件（如安装期播种被跳过）
- **THEN** 启动流程写入 starter profile 文件 `ask.json`，且该 profile 对本次启动的初始 profile 解析可见

#### Scenario: 启动时不覆盖

- **WHEN** launcher 启动，且全局 `profiles/` 目录中已存在至少一个 `.json` 文件
- **THEN** 不写入新文件，启动继续

#### Scenario: 启动时播种失败降级为警告

- **WHEN** launcher 启动时播种写入失败（如目标目录不可写）
- **THEN** 打印警告，启动继续

### Requirement: 分发 profile-config skill

安装包时与 launcher 每次启动时，系统 SHALL 把随包的 `profile-config` skill 写入用户 agentDir 的 `skills/profile-config/` 目录。该 skill 指导 agent 创建、修改与删除 profile 文件。

该 skill 是普通用户级资源：系统 MUST NOT 为它引入过滤豁免或运行时特判；命名 profile 只在声明引用它时才包含它。

已存在的 skill 文件内容与随包版本不同时 SHALL 覆写为随包版本；内容一致时不写入。分发失败 MUST NOT 使安装或启动失败，SHALL 降级为警告。

#### Scenario: 首次安装

- **WHEN** 用户 agentDir 的 `skills/` 下尚不存在 `profile-config`
- **THEN** 安装写入随包的 skill 文件

#### Scenario: 升级覆写

- **WHEN** 用户 agentDir 的 `skills/profile-config/` 已存在，且内容与随包版本不同
- **THEN** 安装以随包版本覆写

#### Scenario: 分发失败降级为警告

- **WHEN** 安装期写入 skill 文件失败（如目标目录不可写）
- **THEN** 安装降级为警告继续，安装本身不失败

#### Scenario: 启动时补齐或同步

- **WHEN** launcher 启动，且用户 agentDir 的 `skills/profile-config/SKILL.md` 不存在或内容与随包版本不同（如安装期分发被跳过，或包已升级）
- **THEN** 启动流程写入或覆写为随包版本，且该 skill 对本次会话可见

#### Scenario: 启动时内容已一致

- **WHEN** launcher 启动，且 `skills/profile-config/SKILL.md` 内容已与随包版本一致
- **THEN** 不写入文件，启动继续

#### Scenario: 启动时分发失败降级为警告

- **WHEN** launcher 启动时写入 skill 文件失败（如目标目录不可写）
- **THEN** 打印警告，启动继续
