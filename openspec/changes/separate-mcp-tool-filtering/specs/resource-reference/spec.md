# Spec Delta

## MODIFIED Requirements

### Requirement: Tool reference resolution

A `tools` reference's identity SHALL be Pi's non-MCP tool name. References SHALL be expanded against the non-MCP part of Pi's tool registry at that moment; the winner of a same-named registration SHALL determine whether a tool is MCP-owned. MCP-provided tools, including the available ways to invoke them, MUST NOT be enabled or disabled by a profile's `tools` list. This rule SHALL apply to existing and new profiles alike.

Before spawn, resolution SHALL expand only against built-in tool names, because tools contributed by extensions are unknowable until extension code runs. After session start, the extension SHALL re-expand the original references against the live registry that includes non-MCP extension tools. MCP tools available under the profile's MCP server and tool selections SHALL remain usable independently of `tools`.

When `tools` is undeclared, the resolution result MUST NOT contain a tools field and Pi's current available tool set SHALL remain unchanged, except when a declared per-server MCP tool restriction itself changes MCP availability.

Literal tool references SHALL NOT be validated or recorded at resolution time; literals for which no non-MCP tool is provided SHALL be reported by the post-session-start expansion and MUST NOT be silently dropped. References that previously matched only MCP tools SHALL receive actionable migration guidance directing users to `mcp_tools`.

#### Scenario: Only built-in tools expanded before spawn

- **WHEN** a profile declares a glob that only matches extension-contributed tools
- **THEN** the pre-spawn resolution contains no results for that glob and does not fail because of it

#### Scenario: Live registry expansion after session start

- **WHEN** the session starts and the extension expands the original references against the live registry
- **THEN** globs cover non-MCP extension tools, and literals without a corresponding non-MCP tool are reported

#### Scenario: tools undeclared

- **WHEN** a profile does not declare `tools` and does not restrict MCP tools
- **THEN** the resolution result contains no tools field and Pi's current available tool set is not modified

#### Scenario: Existing tools list no longer excludes MCP

- **WHEN** an existing profile declares `tools: ["read"]` and an enabled MCP server offers `search`
- **THEN** `read` and the server's `search` tool are usable; other non-MCP tools absent from `tools` are not enabled by this profile

#### Scenario: Legacy MCP reference gives migration guidance

- **WHEN** a profile's `tools` references match only MCP-owned tools in the live registry
- **THEN** the reference no longer selects those tools and the user receives a diagnostic naming `mcp_tools` as the replacement

### Requirement: Unified failure tiering for references

Reference resolution SHALL be tiered by error certainty and MUST NOT silently drop any reference.

An unmatched literal SHALL fail activation. A zero-match glob SHALL be collected as a warning item, visible in launch output and status queries, without blocking activation.

Pi tool references are the exception: they are unknowable before spawn, so they neither fail on a pre-spawn miss nor get recorded as warning items. After session start, missing Pi tool literals SHALL be reported. MCP tool-name verification follows "Per-server MCP tool reference resolution" and MUST NOT claim a missing tool on the basis of an absent or stale catalog.

#### Scenario: Different outcomes for literals and globs

- **WHEN** a profile references both a nonexistent literal skill name and a zero-match skill glob
- **THEN** activation fails because of the literal, while the glob itself only produces a warning item

## ADDED Requirements

### Requirement: Per-server MCP tool reference resolution

`mcp_tools` SHALL select original tool names within each explicitly named MCP server, independently of the Pi `tools` field. A server not named in `mcp_tools` SHALL retain its normal tool availability. An empty object SHALL change nothing. A server mapped to an empty list SHALL offer no callable MCP tools while remaining an enabled server; a nonempty list SHALL permit only listed tools. Adapter-side restrictions already placed on a server MUST NOT be widened.

Every server key SHALL resolve to a discovered, profile-controllable, enabled server; an unknown, disabled, or project-only server SHALL fail activation with an error naming the server and usable candidates or the project-scope boundary. A nonempty `mcp_tools` declaration SHALL require an active MCP adapter; an absent or empty `mcp_tools` object SHALL introduce no adapter dependency.

Tool-name misses SHALL NOT be inferred from missing or stale metadata before the server's authoritative tool list is available. Once that list is available, each listed name with no corresponding tool SHALL be reported with server name and available candidates; a wrong name MUST NOT silently become an unrestricted server. The same restriction SHALL hold for direct tools and indirect routes through MCP gateways, proxies, and scripts, including tools added after the initial session start.

#### Scenario: Missing server key defaults to all tools

- **WHEN** an enabled `github` server offers `search` and `delete`, and `mcp_tools` has no `github` entry
- **THEN** both tools remain available, subject to the server's existing restrictions, regardless of the profile's `tools` list

#### Scenario: Explicit per-server whitelist

- **WHEN** `mcp_tools` sets `github` to `["search"]` and the server offers `search` and `delete`
- **THEN** only `search` is available through direct and indirect MCP tool invocation; `delete` is not exposed or callable

#### Scenario: Empty server list denies all tools

- **WHEN** `mcp_tools` sets `github` to `[]`
- **THEN** no tool offered by `github` can be exposed or called, while the server remains enabled for its non-tool functions

#### Scenario: Server name typo fails before activation

- **WHEN** `mcp_tools` names a server absent from the discovered and enabled profile-controllable servers
- **THEN** activation fails with the name and usable server candidates

#### Scenario: Tool name typo diagnosed after authoritative discovery

- **WHEN** `github` has reported its complete tool list and a declared original tool name does not exist
- **THEN** the user receives an actionable diagnostic identifying the server and name and suggesting available tool names

#### Scenario: Unavailable tool list is not assumed empty

- **WHEN** a configured server has not yet reported a complete tool list
- **THEN** its explicitly configured names are not reported as missing solely because of that incomplete discovery, and its configured restriction remains in effect

#### Scenario: Existing adapter restrictions are not widened

- **WHEN** the adapter already excludes an MCP tool and `mcp_tools` lists that tool
- **THEN** the tool remains unavailable, and the restriction does not silently become permission to invoke it

#### Scenario: Project-only server is outside the narrowing boundary

- **WHEN** `mcp_tools` names a server defined only by trusted project configuration
- **THEN** activation fails with an explanation that a profile cannot narrow that project-level server, and the project server is unchanged
