# resource-reference Specification

## Purpose
Defines what a profile can reference, how those references resolve, and which resolution failures block activation versus only produce warnings. It is the shared resolution contract of both the launch and the switching paths.

## Requirements

### Requirement: Skill reference resolution

A skill reference's identity SHALL be Pi's skill name. Resolution SHALL take Pi's own complete discovery result in a read-only manner, MUST NOT implement directory scanning of its own, and MUST NOT execute any extension code or install any package because of resolving a profile.

Same-named skills SHALL be adjudicated by Pi's existing discovery precedence.

Discovery SHALL run again on every resolution, so added or removed skills take effect on the next launch or reload.

Project-scope skills SHALL participate only when the project is trusted. Skills provided by project-scope packages MUST NOT be referenceable. Project-level skills provided by a trusted project stay in the resolution vocabulary, but their visibility does not change with the profile's selection; the narrowing boundary is in "Narrowing boundary of project-level resources".

#### Scenario: Skill not matched

- **WHEN** a profile declares a literal skill name absent from the discovery result
- **THEN** activation fails with an error identifying the name

#### Scenario: Untrusted project's skills do not participate

- **WHEN** the project is untrusted and skills exist under the project directory
- **THEN** those skills do not appear in the referenceable set and the discovery process does not scan that project

### Requirement: Extension reference resolution

The referenceable forms of an extension reference SHALL include: package name, `<package>:<relative path>` entry ID of multi-entry packages, package source alias, IDs of loose files under standard extension directories, globs, and absolute or `~/` paths.

A loose file's ID SHALL be its path relative to the extension directory minus the `.ts` or `.js` suffix; a directory-style extension's `index.<ext>` SHALL collapse to the directory name.

Discovery SHALL be read-only: it MUST NOT install packages, MUST NOT touch the network, MUST NOT modify the filesystem, and MUST NOT import extension modules.

#### Scenario: Package selected by package name or source alias

- **WHEN** an installed package has a single extension entry and the profile references its package name or its source alias
- **THEN** that package's entry is selected

#### Scenario: Multi-entry package selected by entry ID

- **WHEN** an installed package has multiple extension entries and the profile references `<package>:<relative path>`
- **THEN** only that entry is selected

#### Scenario: Loose file selected by ID

- **WHEN** the extension directory contains `conventions.ts`, or `sub/index.ts`
- **THEN** the former is referenceable as `conventions` and the latter as `sub`

### Requirement: Failure behavior of extension references

An unknown literal reference SHALL fail activation; the error SHALL list the discovered candidate names and provide near-miss hints when they exist.

A relative-path reference SHALL fail activation; the error SHALL explain that an absolute or `~/` path is required.

A path reference MUST point at an existing extension file; when the file does not exist it SHALL fail activation.

When none of a package's entries is usable it SHALL fail activation; the error SHALL explain that the package declares no usable extension entries.

A zero-match glob reference SHALL NOT block activation.

#### Scenario: Unknown literal reference

- **WHEN** a profile references a name that is neither a package name, nor a loose-file ID, nor an existing path
- **THEN** activation fails with an error listing the discovered candidates and providing near-miss hints

#### Scenario: Relative-path reference

- **WHEN** a profile references an extension as `./local.ts`
- **THEN** activation fails with an error explaining that an absolute or `~/` path is required

#### Scenario: Package has no usable extension entries

- **WHEN** a profile references a configured package whose entries are all missing or filtered out
- **THEN** activation fails with an error explaining that the package declares no usable extension entries

### Requirement: Extension ID collisions

When a loose file and a package name produce the same ID, the loose file SHALL win, the system SHALL log a warning, and the package SHALL remain selectable via its source alias.

#### Scenario: Loose file with the same name as a package

- **WHEN** the extension directory contains a loose extension with the same name as an installed package
- **THEN** referencing that name selects the loose file, produces a warning, and the package remains selectable via its source alias

### Requirement: MCP server reference resolution and the adapter dependency

An MCP server reference's identity SHALL be a server name discovered in `pi-mcp-adapter` configuration.

Discovery SHALL read the standard configuration locations recognized by the adapter; project-scope configuration SHALL be read only when the project is trusted. When configuration content is illegal the system SHALL report an error identifying the file path and MUST NOT silently read it as "no servers".

When a profile declares MCP servers while the adapter's discovery result is unavailable, activation SHALL fail: this covers both the adapter being inactive and no usable server discovery result.

With an active adapter, an explicitly empty `mcps` list SHALL resolve to an empty server selection, even when discovery finds no servers. Without an active adapter, an empty `mcps` list alone SHALL leave MCP availability unchanged and SHALL NOT introduce an adapter dependency.

A profile that declares no MCP servers MUST NOT depend on the adapter because of that.

#### Scenario: Untrusted project's MCP configuration does not participate

- **WHEN** the project is untrusted and an MCP configuration file exists under the project directory
- **THEN** the servers in that file do not appear in the referenceable set and the file is not read

#### Scenario: Illegal MCP configuration content

- **WHEN** an MCP configuration at a standard location is not legal JSON, or is not an object
- **THEN** an error is reported identifying the file path, instead of reading it as "no servers"

#### Scenario: MCP servers declared but adapter unavailable

- **WHEN** a profile declares `mcps` while `pi-mcp-adapter` is not active
- **THEN** activation fails with an error explaining that the adapter must be selected in the profile's extensions, or the `mcps` declaration must be removed

#### Scenario: Empty selection with active adapter

- **WHEN** a profile declares `mcps: []` and `pi-mcp-adapter` is active, whether or not any servers are discovered
- **THEN** the resolution result contains no user-level MCP servers and activation succeeds

#### Scenario: Empty selection without adapter

- **WHEN** a profile declares `mcps: []` and no `pi-mcp-adapter` is active
- **THEN** MCP availability remains unchanged and activation succeeds

#### Scenario: Unknown server name

- **WHEN** a profile declares a server name the adapter has not discovered
- **THEN** activation fails with an error identifying the name

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

### Requirement: Resolution and validation of profile-level settings fields

`defaultProvider`, `defaultModel`, `defaultThinkingLevel`, and `instructions` SHALL all be optional. Undeclared fields MUST NOT enter the resolution result.

`defaultProvider` and `defaultModel` constitute a model declaration only when declared together. When only one is declared, the model declaration does not hold and `defaultThinkingLevel` is ignored along with it.

When the model declaration holds, `defaultThinkingLevel` SHALL come from a fixed set; a value outside the set SHALL fail activation. The model SHALL be validated to exist and be authenticated; failed validation, or the absence of any usable validation means, SHALL fail activation and MUST NOT be skipped.

#### Scenario: Illegal thinkingLevel

- **WHEN** a profile declares `defaultProvider`, `defaultModel`, and a `defaultThinkingLevel` outside the allowed set
- **THEN** activation fails with an error identifying the value

#### Scenario: Only thinkingLevel declared

- **WHEN** a profile declares `defaultThinkingLevel` without `defaultProvider` and `defaultModel`
- **THEN** the thinking level is ignored — neither validated nor effective — and Pi's current thinking level remains unchanged

#### Scenario: Declared model fails validation

- **WHEN** the model declared by the profile does not exist or is not authenticated
- **THEN** activation fails with an error identifying the model and the failure reason

#### Scenario: Validation not skipped when no validation means

- **WHEN** a profile declares a model and the caller provides no model-validation capability
- **THEN** activation fails instead of being treated as passed

### Requirement: Unified failure tiering for references

Reference resolution SHALL be tiered by error certainty and MUST NOT silently drop any reference.

An unmatched literal SHALL fail activation. A zero-match glob SHALL be collected as a warning item, visible in launch output and status queries, without blocking activation.

Pi tool references are the exception: they are unknowable before spawn, so they neither fail on a pre-spawn miss nor get recorded as warning items. After session start, missing Pi tool literals SHALL be reported. Literal adapter selectors in `mcp_tools` are restrictive policy inputs rather than pre-spawn-resolvable references; they SHALL remain in the policy without a missing-name diagnostic.

#### Scenario: Different outcomes for literals and globs

- **WHEN** a profile references both a nonexistent literal skill name and a zero-match skill glob
- **THEN** activation fails because of the literal, while the glob itself only produces a warning item

### Requirement: Narrowing boundary of project-level resources

A profile's skill and extension selection SHALL apply only to user-level resources: resources under the real agentDir and `~/.agents/skills`.

The visibility of project-level resources (project `.pi/skills`, project `.pi/extensions`, ancestor `.agents/skills`) SHALL be decided by Pi's project-trust determination: when the project is trusted they are visible under every profile; when untrusted, visible under none.

Project-level resources not selected by the profile MUST NOT be excluded, and project-level resources selected by the profile MUST NOT thereby be written as additional resource paths. A trusted project's project-level resources SHALL stay in the resolution vocabulary; referencing them MUST NOT fail activation as unmatched and MUST NOT produce zero-match warnings.

#### Scenario: Unselected project-level skills stay visible

- **WHEN** the project is trusted, the project contains skill A and skill B, and the active profile declares only A
- **THEN** both A and B are usable in the session

#### Scenario: Project-level references resolve successfully

- **WHEN** the project is trusted and the profile declares skill names, extension IDs, or their globs found in the project
- **THEN** resolution succeeds — neither failing on literals nor producing zero-match warnings

#### Scenario: Project-level resources do not participate when untrusted

- **WHEN** the project is untrusted and the project directory contains skills and extensions
- **THEN** neither appears in the referenceable set nor in the session

### Requirement: Per-server MCP tool reference resolution

`mcp_tools` SHALL narrow tools within each explicitly named MCP server using the active adapter's literal tool-selector matching, independently of the Pi `tools` field. The profile-catalog field contract defines which literals are accepted; the adapter MAY match a tool by its original or prefixed name. A server not named in `mcp_tools` SHALL retain its normal tool availability. An empty object SHALL change nothing. A server mapped to an empty list SHALL offer no callable MCP tools while remaining an enabled server; a nonempty list SHALL permit only tools matched by listed selectors. Adapter-side restrictions already placed on a server MUST NOT be widened.

Every server key SHALL resolve to a discovered, profile-controllable, enabled server; an unknown, disabled, or project-only server SHALL fail activation with an error naming the server and usable candidates or the project-scope boundary. A nonempty `mcp_tools` declaration SHALL require an active MCP adapter; an absent or empty `mcp_tools` object SHALL introduce no adapter dependency.

Literal selectors in `mcp_tools` SHALL NOT be checked against a server's tool list or produce missing-name notifications or validation status. A selector matching no tool SHALL remain restrictive: it MUST NOT silently become an unrestricted server. Existing adapter exclusions SHALL continue to apply. If an existing adapter allowlist and the profile policy cannot be combined without potentially widening the former, activation SHALL fail with an actionable error naming the server before writing runtime files. The resulting restriction SHALL hold for direct tools and indirect routes through MCP gateways, proxies, and scripts, including tools added after the initial session start.

#### Scenario: Missing server key defaults to all tools

- **WHEN** an enabled `github` server offers `search` and `delete`, and `mcp_tools` has no `github` entry
- **THEN** both tools remain available, subject to the server's existing restrictions, regardless of the profile's `tools` list

#### Scenario: Explicit per-server whitelist

- **WHEN** `mcp_tools` sets `github` to `["search"]` and the server offers `search` and `delete`
- **THEN** only `search` is available through direct and indirect MCP tool invocation; `delete` is not exposed or callable

#### Scenario: Prefixed literal follows adapter matching

- **WHEN** server `fixture` offers original tool `search`, the adapter recognizes `fixture_search` as a name for that tool, and `mcp_tools` sets `fixture` to `["fixture_search"]`
- **THEN** `search` is available through direct and indirect MCP tool invocation because the literal selector matches it; tools not matched by that selector remain unavailable

#### Scenario: Empty server list denies all tools

- **WHEN** `mcp_tools` sets `github` to `[]`
- **THEN** no tool offered by `github` can be exposed or called, while the server remains enabled for its non-tool functions

#### Scenario: Server name typo fails before activation

- **WHEN** `mcp_tools` names a server absent from the discovered and enabled profile-controllable servers
- **THEN** activation fails with the name and usable server candidates

#### Scenario: Special-looking unknown server is not discovered

- **WHEN** `mcp_tools` names `toString` or `__proto__` but no such server was discovered
- **THEN** activation fails with that server name and usable candidates instead of treating the key as implicitly present

#### Scenario: Unmatched literal selector stays restrictive without a diagnosis

- **WHEN** `mcp_tools` lists `serach` for `github` but the adapter matches no offered tool to that selector, regardless of whether its complete tool list has been discovered
- **THEN** `search` remains unavailable through direct and indirect MCP tool calls, and the user receives no tool-name validation warning or missing-name status

#### Scenario: Existing adapter restrictions are not widened

- **WHEN** the adapter already excludes an MCP tool and `mcp_tools` lists a selector matching that tool
- **THEN** the tool remains unavailable, and the restriction does not silently become permission to invoke it

#### Scenario: Unsafe allowlist intersection fails before runtime writes

- **WHEN** an existing adapter `includeTools` and the profile's literal selectors use different spellings that could match the same tool or collide with another tool's name
- **THEN** activation fails with the server name and an unsafe-intersection explanation before runtime files are written, rather than replacing the adapter's restriction with a potentially wider one

#### Scenario: Project-only server is outside the narrowing boundary

- **WHEN** `mcp_tools` names a server defined only by trusted project configuration
- **THEN** activation fails with an explanation that a profile cannot narrow that project-level server, and the project server is unchanged
