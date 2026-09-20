# 纯发现过滤；退役 resources.json 与 ResourceRegistry

取代 ADR-0006。

## 背景

ADR-0006 引入了 extension 自动发现，但保留了 `resources.json` 作为显式覆盖层，并带 `dependsOn`（依赖闭包与环检测）与 `alwaysOn`（不可禁用的系统 extension）。

实践中的代价：

- Pi 本身没有 extension 依赖图，也没有常驻 extension 概念。在 pi-profile 内管理依赖，等于把自己变成临时包管理器。
- `profiles.json` 与 `resources.json` 两个配置面，加上 `/profile resource [list|create|edit|delete]` 命令族，显著扩大了概念与 CLI 面积。

## 决策

彻底退役 `resources.json`、`resources.schema.json` 与 `ResourceRegistry`。extension 采用与 skill 一致的纯「发现并过滤」模型：

1. 发现读取已安装的用户包与标准目录下的散装 extension 文件。
2. profile 直接声明 extension 引用。解析是对已发现集合的纯过滤，没有依赖闭包，没有环检测。
3. runtime overlay 可以禁用任意已解析的 extension，`alwaysOn` 限制被取消。
4. `/profile resource *` 命令族及其向导被删除，`/profile` 只管理 profile。

## 被否方案

**保留 `resources.json` 作为覆盖层**（ADR-0006 的设计）。否掉的理由见背景两条代价。

## 代价

- extension 位于非标准路径时，只能由 profile 写绝对路径引用，不能再注册一个稳定 ID。
- 没有依赖声明，profile 必须自己列全所需的 extension。
