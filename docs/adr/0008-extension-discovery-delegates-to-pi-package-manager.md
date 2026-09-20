# extension 发现把入口枚举委托给 Pi 的 package manager

细化 [ADR-0007](0007-discovery-only-extension-filtering.md)：发现保留，入口枚举不再自己实现。

## 背景

ADR-0007 确立了「发现并过滤」，但没有定下**由谁拥有发现规则**。`extension-discovery.ts` 手工重新实现了它们：读 `package.json#pi.extensions`、`stat` 每个声明入口、扫描 extensions 目录下的 `*.{ts,js}`、推导文件名 stem。Pi 在 `package-manager.js` 里解析同样的事实（`collectAutoExtensionEntries` → `resolveExtensionEntries` → `collectFilesFromPaths`，外加自己的 `+`/`-`/`!` 过滤与 ignore 规则）。

两套实现静默且反复地漂移：

- **目录入口被丢弃。** `"extensions": ["./dist"]` 是所有编译型 extension 包的惯例，而手工检查要求常规文件，于是 `pi-web-access` 解析为空，激活失败并报 `unknown extension: "pi-web-access"`，同时 Pi 自己加载该包是正常的。这是暴露问题的那个 bug。
- **忽略规则缺失。** `.gitignore`、dot-file、`node_modules` 排除与包级 include/exclude 过滤都不存在，可引用名列表里因此包含 Pi 永远不会加载的条目。
- **缺口不可测。** 之后每一个新的 Pi 约定都要在这里补一份实现，而测试只用手工规则互相验证，无法发现与 Pi 的不一致。

代价是 120 多行镜像逻辑，且只能被验证为内部自洽，永远无法被验证为与 Pi 一致。

## 决策

保留发现，删除重新实现的规则。`ExtensionDiscovery` 改为调用 Pi 自己的 resolver 并对其输出分类：

1. **入口枚举交给 Pi。** `discoverImplicitExtensions` 构造 `DefaultPackageManager`（`SettingsManager.create(cwd, agentDir, { projectTrusted })`）并调用 `resolve(async () => "skip")`。包入口、散装文件、优先级与过滤全部来自 Pi 的实现。
2. **`"skip"` 保持只读契约。** `onMissing: "skip"` 把缺失来源报告为不存在，而不是安装它们——不安装、不联网、不改文件系统。扩展模块仍从不 import。
3. **pi-profile 只保留自己的概念。** 可引用 ID、项目覆盖全局的合并、`select()` 解析与错误文案。包来源的条目按配置来源分组，条目始终是具体文件，因为这是 Pi resolver 的输出形态。
4. **路径引用指向文件。** profile 的绝对路径或 `~/` 引用必须指向 extension 文件，不做目录展开：loader 逐字 import 引用路径，生成的包 allowlist 也只匹配文件路径，接受目录只会把失败往后挪。

## 被否方案

**继续手工实现发现规则**（ADR-0007 的实现）。否掉的理由见背景三条漂移。

## 代价

- 耦合到 `resolve()`（`PackageManager` 的公开 API），而不是未导出的内部实现。SDK 变更会失败在明确的位置，而不是静默漂移。
- `resolve()` 同时解析 skills、prompts 与 themes，这部分工作与 `SkillRegistry` 重复。它是只读的、与 skill 发现并行运行、不需要子进程或网络，因此接受，而不是重新实现一个 Pi 未暴露的更窄 resolver。
- 被 `.gitignore`、dot-file、`node_modules` 规则或包自身过滤器排除的条目不再出现在可引用列表里。它们本来也无法加载。
- 全部入口被过滤掉的包仍会列出，但入口为零；选中时报 `declares no extension entries`，而不是 `unknown extension`。
