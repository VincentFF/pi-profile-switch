# Design

## Context

See [proposal.md](proposal.md). Today `resolveProfile` expands `tools` against built-ins; `applyLaunchPlan` expands the same list against every live Pi tool; `writeRuntimeFiles` generates `mcp.json` only when `mcps` is resolved. The adapter owns MCP tool discovery, gateway routing and server-side `includeTools`/`excludeTools`. Pi exposes the winning tool registration's `sourceInfo.path` through `getAllTools()`. A tool's Pi name cannot reliably identify its MCP origin because adapter prefixes are configurable and gateways can call tools not registered as direct Pi tools.

The server configuration is layered; project-level servers are outside profile narrowing. No adapter package is a required runtime dependency. The adapter does not expose a verifiable live tool-name catalog through every supported extension entry; the profile policy can still be enforced without one.

## Goals / Non-Goals

**Goals:** Keep Pi-tool and per-server MCP-tool selection independent across launch and in-session reload. Enforce MCP restrictions before the first agent turn and through gateway, namespace and script execution. Preserve existing adapter restrictions, validate server keys before activation, and report missing Pi tool literals after session start.

**Non-Goals:** Filter project-only servers; change connection/authentication settings; add MCP transport handling; enumerate every server's tools at launcher startup; add persistent overlay fields.

## Decisions

### 1. Catalog shape and migration

Use `mcp_tools: Record<string, string[]>` in profile JSON. Keys are literal configured server names; values are literal original tool names. Empty object/omitted field is a no-op, omitted server key means native adapter access, and empty array denies its tools. No glob support for this field in the first change: exact names express a predictable adapter allowlist independent of model-facing prefixes. Tool names are not checked against a live catalog; a misspelled name stays restrictive without a warning. `tools` becomes non-MCP-only for all profiles, without a legacy mode. README and the distributed skill will explain how to move old MCP names out of `tools`.

ADR required: per-server-mcp-tool-selection

Rejected: implicit adapter-tool passthrough controlled by Pi tool-name globs (prefix drift and indirect calls), and keeping `tools` as a second simultaneous MCP allowlist (breaks the promised omitted-server default).

### 2. Server filtering belongs to the adapter's instance config

`writeRuntimeFiles` will generate a real instance `mcp.json` when either `mcps` needs server filtering or `mcp_tools` has server keys. With no restrictions, keep the existing symlink/pass-through behavior. In the generated instance file, copy the merged user-level server definition, preserving all original connection, resource, and adapter settings. For a nonempty tool list, use its original names in the adapter's per-server `includeTools`; retain existing `excludeTools`. For an empty list, use `excludeTools: ["*"]` because the adapter treats `includeTools: []` as unrestricted. Do not mutate source files. Server filtering from `mcps`, shared-server disable entries and project-owned definitions retain their existing rules.

A pre-existing nonempty `includeTools` is an additional restriction. For profile exact names, retain only those proven allowed by the existing selector; if the intersection cannot be represented safely with the available adapter selector semantics, raise `ActivationError` with the server name before writing any runtime file rather than broaden access. Resolve the effective server definitions and restrictions as one in-memory snapshot; the materializer consumes this prepared snapshot so validation and writing cannot diverge. Existing `excludeTools` always wins. Project-only and project-shadowed servers cannot receive a profile tool filter; fail before materialization. When `mcps` is absent, generate a configuration that keeps every previously available user-level server, not an implicit server whitelist.

Rejected: filtering only `getAllTools()` names, which leaves `mcp`, `mcpScript` and namespace proxies able to invoke blocked tools. Rejected: rewriting the user's adapter configuration, which would persist a per-profile choice across other Pi processes.

### 3. Pi tool selection uses registration ownership

On `session_start`, classify each live Pi tool by the winner's `sourceInfo` and the selected adapter entry. Exclude adapter-owned registrations from `tools` expansion, and preserve their adapter-selected availability when computing `setActiveTools` for a profile declaring `tools`. A legacy `tools` literal or glob that matches only adapter-owned registrations yields a migration diagnostic; a name collision follows Pi's actual winning registration. The existing `defaultTools` setting remains only the built-in boot baseline. With neither `tools` nor an overlay, do not call `setActiveTools` solely because `mcp_tools` is present: the instance configuration enforces it before tool registration. Existing overlay tool-name matching still happens against its established base, and its disabled names are subtracted from the resulting active set.

Rejected: identifying MCP ownership by `mcp__*` or `<server>_*`: prefix overrides, no-prefix direct tools and collisions make that unsafe.

### 4. Validate server keys; do not verify MCP tool names

Before spawn/switch, resolve each `mcp_tools` server key against the enabled user-level server names. Require the adapter only for nonempty `mcp_tools`; report disabled, unknown or project-only keys as `ActivationError` with candidates. Do not connect to servers as part of profile resolution.

Pass literal original tool names through to the adapter's restrictive policy without comparing them against a live catalog. A name absent from the server's tools neither grants access to another tool nor produces a missing-name notification, validation state, or candidate list. Keep Pi tool-literal and legacy MCP-reference diagnostics distinct from these unchecked `mcp_tools` names. This removes the optional adapter metadata-cache import and its dependence on cache freshness or extension packaging; enforcement continues through the instance configuration.

For `/profile status`, derive the effective disabled state alongside discovered server names from the same trusted adapter configuration discovery used for resolution. Without an explicit `mcps` selection, list a server marked `disabled: true` as discovered but not enabled. Report each enabled server's declared tool policy without claiming the original tool names exist. Keep the existing tri-state for an explicit `mcps` selection and for unresolved server references.

### Export surface

| File | Export / signature | Error or result |
| --- | --- | --- |
| `src/profile-catalog.ts` | `ProfileDefinition.mcp_tools?: Record<string, string[]>`; `parseProfileDefinition(name: string, raw: unknown, filePath?: string): ProfileDefinition` | `CatalogError` with field and profile path |
| `src/mcp-config.ts` | Extend `MergedMcpResult` with `serverOwners: Record<string, "user" \| "project">`; keep `loadMergedMcpServers(agentDir: string, projectDir?: string, options?: McpDiscoveryOptions): Promise<MergedMcpResult>` | Winning origin for preflight; retain `McpConfigError` for malformed config |
| `src/profile-resolver.ts` | `ActivationPlan.mcpTools?: Record<string, string[]>` and `ActivationPlan.instanceMcpConfig?: Record<string, unknown>` (memory only); `ResolveInput.mcpDiscovery?: MergedMcpResult`; `resolveProfile(input: ResolveInput): Promise<ActivationPlan>` | `ActivationError` for unknown, disabled, project-owned servers, unsafe filter intersections or missing adapter |
| `src/settings-generator.ts` | `writeRuntimeFiles(runtimeDir: string, plan: ActivationPlan, options: RuntimeFileOptions): Promise<void>` | Consumes prevalidated `instanceMcpConfig` without serializing credentials to `pi-profile.json`; IO errors use existing rollback; never writes source adapter config |
| `src/switching/apply-plan.ts` | `LaunchPlanFile.mcpTools?: Record<string, string[]>`; `PlanApplicationSurface.getAllTools(): Array<{name: string; sourceInfo?: {path: string; source: string}}>`; `applyLaunchPlan(input): Promise<ApplyResult>` | Pi tool-literal and legacy MCP-reference diagnostics in `warnings`; no `mcp_tools` name checks |
| `src/switching/status.ts` | `StatusReport.mcpTools?: McpServerToolStatus[]` with `McpServerToolStatus = {server: string; policy: "unrestricted" \| "restricted" \| "none"; tools?: string[]}`; `buildStatusReport(input: {plan: LaunchPlanFile; overlay?: RuntimeOverlay; discoveredMcpServers: string[]; disabledMcpServers: string[]; commands: RegisteredCommand[]; tools: RegisteredTool[]}): StatusReport` | Caller supplies disabled names from the same trusted server discovery as the discovered names; policy-only status and accurate MCP tri-state, without name-validation fields |

Keep the plan file's new policy data with the existing managed snapshot; switching writes and restores it through the existing rollback path. No new state file.

## Risks / Trade-offs

- [Adapter filtering semantics change] -> Use a development-only adapter dependency for real-adapter fixture tests of nonempty allowlists, empty deny-all, gateway/script attempts and metadata refresh; fail closed on a filter intersection that cannot be proved. Runtime remains adapter-optional.
- [Original server definitions mix project and user layers] -> Validate ownership after precedence is applied and test a project-only and same-name project override; do not silently narrow project content.
- [Adapter-owned Pi tools appear after `session_start`] -> The adapter's server-side filter is the enforcement layer; test direct-tool hot registration and preserve gateway availability without allowing excluded calls.
- [Unrecognized original MCP tool name] -> Keep the adapter allowlist restrictive without an unsolicited tool-name warning; document that users are responsible for the exact name. Avoid treating an absent catalog as permission or building a runtime adapter dependency for diagnostics.
- [Legacy `tools` globs change meaning] -> Announce the breaking change with a before/after example, update the shipped example and profile-config skill, and show migration diagnostics on reload.

## Migration Plan

Ship the new field and the changed `tools` semantics together. Document that existing profiles depending on `mcp__*`, server-prefixed patterns, or proxy names in `tools` must move desired restrictions to `mcp_tools`; omission deliberately allows all tools of enabled servers. The built-in `default` remains unfiltered. Preserve catalog files as written; do not auto-rewrite profiles or adapter source files. Rollback of an in-session switch uses the existing full runtime-file snapshot and reload; package downgrade requires users who adopted `mcp_tools` to retain their prior configuration separately because older versions ignore unknown fields.
