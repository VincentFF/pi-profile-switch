# Spec Delta

## MODIFIED Requirements

### Requirement: Skill 引用解析

skill 引用的身份 SHALL 是 Pi 的 skill name。解析 SHALL 以只读方式取 Pi 自身的完整发现结果，MUST NOT 自行实现目录扫描，也 MUST NOT 因解析 profile 而执行任何 extension 代码或安装任何包。

同名 skill SHALL 按 Pi 原有的发现优先级裁决。

发现 SHALL 在每次解析时重新运行，因此新增或删除的 skill 在下一次启动或 reload 生效。

项目范围的 skill SHALL 只在项目已受信任时参与。由项目范围 package 提供的 skill MUST NOT 可引用。受信任项目提供的项目级 skill 留在解析词汇表内，但其可见性不随 profile 的选择变化；收窄边界见「项目级资源的收窄边界」。

#### Scenario: skill 未匹配

- **WHEN** profile 声明一个字面量 skill 名，而发现结果中没有该名字
- **THEN** 激活失败，错误指明该名字

#### Scenario: 未受信任项目的 skill 不参与

- **WHEN** 项目未受信任，且该项目目录下存在 skill
- **THEN** 该 skill 不出现在可引用集合中，发现过程不扫描该项目

## ADDED Requirements

### Requirement: 项目级资源的收窄边界

profile 的 skill 与 extension 选择 SHALL 只作用于用户级资源：真实 agentDir 下的资源与 `~/.agents/skills`。

项目级资源（项目 `.pi/skills`、项目 `.pi/extensions`、ancestor `.agents/skills`）的可见性 SHALL 由 Pi 按项目信任判定决定：项目已受信任时它们在任何 profile 下都可见，项目未受信任时都不可见。

profile 未选中的项目级资源 MUST NOT 被排除，profile 选中的项目级资源 MUST NOT 因此被写成额外的资源路径。受信任项目的项目级资源 SHALL 留在解析词汇表内，引用它们 MUST NOT 因未匹配而使激活失败，也 MUST NOT 产生零匹配警告。

#### Scenario: 未选中的项目级 skill 仍然可见

- **WHEN** 项目已受信任，项目内有 skill A 与 skill B，活动 profile 只声明 A
- **THEN** A 与 B 在会话中都可用

#### Scenario: 项目级引用解析成功

- **WHEN** 项目已受信任，profile 声明项目内的 skill 名、extension ID 或它们的 glob
- **THEN** 解析成功，既不为字面量失败，也不产生零匹配警告

#### Scenario: 未受信任时项目级资源不参与

- **WHEN** 项目未受信任，且项目目录下存在 skill 与 extension
- **THEN** 两者都不出现在可引用集合中，也不出现在会话里
