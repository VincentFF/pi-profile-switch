# resource-reference Specification

## Purpose
定义 profile 能引用什么、这些引用如何解析、以及解析失败时哪些情况阻塞激活、哪些只产生警告。它是启动与切换两条路径共同的解析契约。

## Requirements

### Requirement: Skill 引用解析

skill 引用的身份 SHALL 是 Pi 的 skill name。解析 SHALL 以只读方式取 Pi 自身的完整发现结果，MUST NOT 自行实现目录扫描，也 MUST NOT 因解析 profile 而执行任何 extension 代码或安装任何包。

同名 skill SHALL 按 Pi 原有的发现优先级裁决。

发现 SHALL 在每次解析时重新运行，因此新增或删除的 skill 在下一次启动或 reload 生效。

项目范围的 skill SHALL 只在项目已受信任时参与。由项目范围 package 提供的 skill MUST NOT 可引用。

#### Scenario: skill 未匹配

- **WHEN** profile 声明一个字面量 skill 名，而发现结果中没有该名字
- **THEN** 激活失败，错误指明该名字

#### Scenario: 未受信任项目的 skill 不参与

- **WHEN** 项目未受信任，且该项目目录下存在 skill
- **THEN** 该 skill 不出现在可引用集合中，发现过程不扫描该项目

### Requirement: Extension 引用解析

extension 引用的可引用形式 SHALL 包括：包名、多入口包的 `<包名>:<相对路径>` 入口 ID、包 source 别名、标准扩展目录下散装文件的 ID、glob，以及绝对路径或 `~/` 路径。

散装文件 ID SHALL 是该文件在扩展目录下的相对路径去掉 `.ts` 或 `.js`；目录型 extension 的 `index.<ext>` SHALL 折叠为目录名。

发现 SHALL 只读：MUST NOT 安装包、MUST NOT 联网、MUST NOT 改动文件系统、MUST NOT import extension 模块。

#### Scenario: 包按包名或 source 别名选中

- **WHEN** 已安装包含单个扩展入口，profile 引用其包名或其 source 别名
- **THEN** 该包的入口被选中

#### Scenario: 多入口包按入口 ID 选中

- **WHEN** 已安装包含多个扩展入口，profile 引用 `<包名>:<相对路径>`
- **THEN** 只有该入口被选中

#### Scenario: 散装文件按 ID 选中

- **WHEN** 扩展目录下有 `conventions.ts`，或 `sub/index.ts`
- **THEN** 前者可由 `conventions` 引用，后者可由 `sub` 引用

### Requirement: Extension 引用的失败行为

未知的字面量引用 SHALL 使激活失败，错误 SHALL 列出已发现的候选名字，并在存在相近名时给出提示。

相对路径引用 SHALL 使激活失败，错误 SHALL 说明需要绝对路径或 `~/` 路径。

路径引用 MUST 指向已存在的扩展文件；文件不存在时 SHALL 使激活失败。

包的全部入口都不可用时 SHALL 使激活失败，错误 SHALL 说明该包没有可用的扩展入口。

glob 引用零匹配 SHALL NOT 阻塞激活。

#### Scenario: 未知字面量引用

- **WHEN** profile 引用一个既不是包名、不是散装文件 ID、也不是已存在路径的名字
- **THEN** 激活失败，错误列出已发现的候选并提供相近名提示

#### Scenario: 相对路径引用

- **WHEN** profile 以 `./local.ts` 引用 extension
- **THEN** 激活失败，错误说明需要绝对路径或 `~/` 路径

#### Scenario: 包没有可用的扩展入口

- **WHEN** profile 引用一个已配置但其入口全部缺失或被过滤掉的包
- **THEN** 激活失败，错误说明该包没有可用的扩展入口

### Requirement: Extension ID 碰撞

当散装文件与包名产生同一个 ID 时，散装文件 SHALL 胜出，系统 SHALL 记录一条警告，且该包 SHALL 仍可由 source 别名选中。

#### Scenario: 散装文件与包同名

- **WHEN** 扩展目录下存在与已安装包同名的散装 extension
- **THEN** 按该名字引用选中散装文件，产生一条警告，该包经 source 别名仍可选中

### Requirement: MCP server 引用解析与 adapter 依赖

MCP server 引用的身份 SHALL 是 `pi-mcp-adapter` 配置中已发现的 server 名。

发现 SHALL 读取 adapter 识别的标准配置位置；项目范围的配置 SHALL 只在项目已受信任时读取。配置内容不合法时 SHALL 报错并指明文件路径，MUST NOT 静默读作「没有 server」。

profile 声明了 MCP server 而 adapter 发现结果不可用时 SHALL 使激活失败：这既包括 adapter 未激活，也包括无可用的 server 发现结果。

未声明 MCP server 时，profile MUST NOT 因此依赖 adapter。

#### Scenario: 未受信任项目的 MCP 配置不参与

- **WHEN** 项目未受信任，且该项目目录下存在 MCP 配置文件
- **THEN** 该文件中的 server 不出现在可引用集合中，且该文件未被读取

#### Scenario: MCP 配置内容不合法

- **WHEN** 某个标准位置的 MCP 配置不是合法 JSON，或不是对象
- **THEN** 报错并指明该文件路径，不把它读作「没有 server」

#### Scenario: 声明了 MCP server 但 adapter 不可用

- **WHEN** profile 声明了 `mcps`，而 `pi-mcp-adapter` 未激活
- **THEN** 激活失败，错误说明需要在 profile 的 extensions 中选中该 adapter，或移除 `mcps` 声明

#### Scenario: 未知 server 名

- **WHEN** profile 声明一个 adapter 未发现的 server 名
- **THEN** 激活失败，错误指明该名字

### Requirement: Tool 引用解析

tool 引用的身份 SHALL 是 Pi 的工具名。引用 SHALL 对 Pi 当时的工具注册表展开。

spawn 之前，解析 SHALL 只对内建工具名展开，因为 extension 贡献的工具在 extension 代码运行前不可知。session 启动后，扩展 SHALL 依据原始引用对包含 extension 与 MCP 工具在内的实时注册表重新展开。

未声明 `tools` 时，解析结果 MUST NOT 含 tools 字段，Pi 当前的可用工具集合 SHALL 保持不变。

字面量 tool 引用 SHALL NOT 在解析阶段校验或记录；未提供该工具的字面量 SHALL 由 session 启动后的展开报告，MUST NOT 静默丢弃。

#### Scenario: spawn 前只展开内建工具

- **WHEN** profile 声明一个只匹配 extension 贡献工具的 glob
- **THEN** spawn 前的解析不包含该 glob 的任何结果，也不因此失败

#### Scenario: session 启动后展开实时注册表

- **WHEN** session 启动，extension 依据原始引用对实时注册表展开
- **THEN** glob 覆盖 extension 与 MCP 提供的工具，未提供对应工具的字面量被报告出来

#### Scenario: 未声明 tools

- **WHEN** profile 不声明 `tools`
- **THEN** 解析结果不含 tools 字段，Pi 当前的可用工具集合不被改动

### Requirement: Profile 级设置字段的解析与校验

`defaultProvider`、`defaultModel`、`defaultThinkingLevel` 与 `instructions` SHALL 全部可选。未声明的字段 MUST NOT 进入解析结果。

`defaultProvider` 与 `defaultModel` SHALL 同时声明才构成模型声明。只声明其中一时，模型声明不成立，且 `defaultThinkingLevel` 随之被忽略。

模型声明成立时，`defaultThinkingLevel` SHALL 取自固定集合，不在集合内时 SHALL 使激活失败；模型 SHALL 校验存在且已认证，校验不通过或无可用的校验手段时 SHALL 使激活失败，MUST NOT 跳过校验。

#### Scenario: thinkingLevel 不合法

- **WHEN** profile 同时声明 `defaultProvider`、`defaultModel` 与一个不在允许集合内的 `defaultThinkingLevel`
- **THEN** 激活失败，错误指明该值

#### Scenario: 只声明 thinkingLevel

- **WHEN** profile 声明 `defaultThinkingLevel` 但不声明 `defaultProvider` 与 `defaultModel`
- **THEN** 该 thinking level 被忽略，既不校验也不生效，Pi 当前的 thinking level 保持不变

#### Scenario: 声明的模型校验失败

- **WHEN** profile 声明的模型不存在或未认证
- **THEN** 激活失败，错误指明该模型与失败原因

#### Scenario: 无校验手段时不跳过校验

- **WHEN** profile 声明了模型，而调用方未提供模型校验能力
- **THEN** 激活失败，不按已通过处理

### Requirement: 引用失败的统一分级

引用解析 SHALL 按错误的确定性分级，MUST NOT 静默丢弃任何引用。

未匹配的字面量 SHALL 使激活失败。零匹配的 glob SHALL 被收集为警告项，随启动输出与状态查询可见，不阻塞激活。

tool 是唯一例外：它的引用在 spawn 前不可知，因此既不因未匹配而失败，也不作为警告项记录。

#### Scenario: 字面量与 glob 的不同结果

- **WHEN** profile 同时引用一个不存在的字面量 skill 名与一个零匹配的 skill glob
- **THEN** 激活因字面量失败，而 glob 本身只会产生警告项
