# resource-reference Specification

## Purpose
Defines what a profile can reference, how those references resolve, and which resolution failures block activation versus only produce warnings. It is the shared resolution contract of both the launch and the switching paths.

## Requirements

### Requirement: Sparse skill and extension selection

A named profile SHALL distinguish an omitted `skills` or `extensions` field from an explicitly empty array. Each field SHALL control only its own resource kind. An omitted field SHALL preserve Pi's native visibility for that kind; an empty array SHALL select no referenceable user-level resources of that kind; a nonempty array SHALL follow the existing reference-resolution and failure-tiering contracts.

Native visibility SHALL include resources enabled through the user's native resource settings and package filters, not only resources expressible through a profile name or glob. Native exclusions MUST remain effective. Pi's native built-in extension enable/disable controls MUST retain their meaning under omitted and declared profile selections; their identities and control syntax SHALL defer to Pi's own settings and extension registry.

The existing "Narrowing boundary of project-level resources", "Tool reference resolution", "MCP server reference resolution", and "Per-server MCP tool selection" requirements SHALL remain applicable.

#### Scenario: Omitted skills preserve native visibility

- **WHEN** a named profile omits `skills` and Pi discovers enabled user-level skills from its ordinary discovery sources
- **THEN** activation leaves those skills visible, including enabled package skills, without creating an empty selection

#### Scenario: Omitted extensions preserve native visibility

- **WHEN** a named profile omits `extensions` and the user has enabled loose extensions, package extensions, and a native settings-only extension outside standard directories
- **THEN** activation preserves all of those extensions' native visibility

#### Scenario: Empty selections remain restrictive

- **WHEN** a named profile explicitly declares an empty `skills` or `extensions` array
- **THEN** no referenceable user-level resource of that kind is selected; omission is not substituted for the empty array

#### Scenario: Skill-only selection preserves extensions

- **WHEN** a named profile declares only a skill selection, including an empty one
- **THEN** user-level skills follow that selection while extensions retain native visibility

#### Scenario: Extension-only selection preserves skills

- **WHEN** a named profile declares only an extension selection, including an empty one
- **THEN** referenceable user-level extensions follow that selection while skills retain native visibility

#### Scenario: Declared references retain validation

- **WHEN** an explicit skill or extension selection contains an unmatched literal or a zero-match glob
- **THEN** the literal fails activation and the glob produces the existing non-fatal warning rather than changing the selection into native pass-through

#### Scenario: Native exclusions remain effective

- **WHEN** native settings or package filters disable a skill or extension and a profile omits that kind or selects it through a glob
- **THEN** activation does not make the disabled resource visible, and native force-inclusion exceptions retain their native precedence

#### Scenario: Native built-in extension controls remain effective

- **WHEN** native settings disable a Pi built-in extension, including through a broad exclusion with an explicit native inclusion exception, and a named profile omits `extensions` or declares a reference list
- **THEN** activation retains the resulting native built-in extension enable/disable state without requiring the profile to name those native extensions

#### Scenario: MCP and tool omission stays unchanged

- **WHEN** a named profile omits `mcps` and `tools` and declares no per-server MCP tool policy or tool overlay
- **THEN** no additional MCP server policy or active-tool selection is imposed by the profile; tools supplied only by an excluded extension follow that extension's loading

#### Scenario: Project resources retain their trust boundary

- **WHEN** a profile omits or explicitly empties either resource field in a trusted or untrusted project
- **THEN** project-level visibility continues to follow the existing project-trust boundary rather than the profile field

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

### Requirement: MCP server reference resolution

An MCP server reference's identity SHALL be a server name defined in the merged user-level MCP configuration snapshot. The snapshot SHALL merge by server name from the existing user-level source locations in their established precedence order (defer to the authoritative source list in `src/mcp-config.ts`); each later definition SHALL replace the earlier definition of the same server in full, without inheriting connection, credential, or exposure fields from the earlier definition.

Project-scope configuration SHALL NOT be part of the snapshot: servers defined in a trusted project's `.pi/mcp.json` SHALL be read by Pi itself and SHALL remain outside profile control.

When a profile explicitly declares `mcps` or names any server in `mcp_tools`, illegal configuration content required for discovery SHALL fail activation with an error identifying its file path; the system MUST NOT silently read it as "no servers". When neither field declares an effective MCP policy, illegal content in one user-level source SHALL be diagnosed with its file path without blocking activation; the valid sources SHALL still participate in the snapshot. Illegal content in a trusted project's classification source SHALL NOT block activation without an explicit MCP policy, and Pi SHALL retain ownership of its own project-file diagnostics.

When a profile declares a server name the snapshot does not define, activation SHALL fail with an error identifying the name and near-miss candidates. When `mcps` selects a user-level server explicitly disabled in its winning definition, activation SHALL fail naming the server and telling the user to enable it in the source configuration or remove it from the selection; the profile MUST NOT silently override the source setting. A profile that declares no MCP servers MUST NOT require every MCP source to be valid. An explicitly empty `mcps` list SHALL resolve to an empty server selection.

A server explicitly selected by `mcps` whose definition Pi's built-in MCP extension cannot use — for example the legacy SSE transport — SHALL fail activation with an error naming the server and a migration hint; the authoritative set of supported transports is defined by Pi's built-in MCP extension. A snapshot server not explicitly selected SHALL be passed through to the instance configuration without removing its connection definition, and Pi SHALL report its own configuration errors for it.

#### Scenario: Untrusted project's MCP configuration does not participate

- **WHEN** the project is untrusted and an MCP configuration file exists under the project directory
- **THEN** the servers in that file are not merged into the snapshot and the file is not read

#### Scenario: Illegal MCP configuration content

- **WHEN** a profile declares `mcps` and a user-level MCP configuration is not legal JSON, or is not an object
- **THEN** activation fails with an error identifying the file path, instead of reading it as "no servers"

#### Scenario: Invalid source without MCP policy

- **WHEN** a profile declares neither `mcps` nor any server in `mcp_tools`, one user-level source is malformed, and another contains a valid server definition
- **THEN** activation succeeds with a diagnostic naming the malformed file, and the valid server is present in the generated snapshot

#### Scenario: Malformed trusted-project classification without MCP policy

- **WHEN** a trusted project's MCP file is malformed and the profile declares no effective MCP policy
- **THEN** profile activation continues without merging that file into the user-level snapshot, while Pi handles its project-file diagnostic

#### Scenario: Empty tool policy does not demand valid configuration

- **WHEN** a profile has `mcp_tools: {}` and no `mcps`, and a user-level source is malformed
- **THEN** activation does not fail because of that file and reports its path

#### Scenario: Later user-level source overrides an earlier one per server name

- **WHEN** a later user-level source defines a server with a new URL but omits the earlier definition's authorization header
- **THEN** the snapshot uses the new definition without the earlier authorization header

#### Scenario: Project-owned server cannot be selected

- **WHEN** a trusted project's `.pi/mcp.json` defines server P and a profile names P in `mcps`
- **THEN** activation fails with an error explaining the project-scope boundary, and P remains enabled through Pi's own project read

#### Scenario: Unknown server name

- **WHEN** a profile declares a server name no user-level configuration defines
- **THEN** activation fails with an error identifying the name and near-miss candidates

#### Scenario: Explicitly selected server is disabled in source

- **WHEN** `mcps` selects a server whose winning user-level definition has `enabled: false`
- **THEN** activation fails naming that server and explaining how to enable it in the source or remove it from `mcps`

#### Scenario: Empty selection without any MCP extension

- **WHEN** a named profile declares `mcps: []` and no MCP extension is selected
- **THEN** resolution retains an empty server selection, activation does not fail for a missing extension, and no MCP availability is changed by the empty declaration

#### Scenario: Selected server uses a transport Pi cannot use

- **WHEN** a profile's `mcps` names a server whose definition uses a transport Pi's built-in MCP extension does not support
- **THEN** activation fails with an error naming the server and a migration hint

#### Scenario: Unselected server with a bad transport passes through

- **WHEN** a profile omits `mcps` and the merged snapshot contains a server whose definition Pi's built-in MCP extension does not support
- **THEN** activation succeeds, the server definition is written to the instance configuration unchanged, and Pi reports its own configuration error for it

### Requirement: Tool reference resolution

A `tools` reference's identity SHALL be Pi's non-MCP tool name. References SHALL be expanded against the non-MCP part of Pi's tool registry at that moment; the winner of a same-named registration SHALL determine whether a tool is MCP-owned. MCP-provided tools, including the Pi-provided entry points required to invoke them, MUST NOT be enabled or disabled solely by a profile's `tools` list. This rule SHALL apply to existing and new profiles alike. The available MCP entry points and their names SHALL defer to Pi's MCP tool-exposure behavior, rather than a profile-maintained inventory.

Before spawn, resolution SHALL expand only against built-in tool names, because tools contributed by extensions are unknowable until extension code runs. After session start, the extension SHALL re-expand the original references against the live registry that includes non-MCP extension tools. MCP tools available under the profile's MCP server and tool selections SHALL remain usable independently of `tools`.

When `tools` is undeclared, the resolution result MUST NOT contain a tools field and Pi's current available tool set SHALL remain unchanged, except when a declared per-server MCP tool restriction itself changes MCP availability. Pi's native MCP discovery behavior SHALL remain in control.

Literal tool references SHALL NOT be validated or recorded at resolution time; literals for which no non-MCP tool is provided SHALL be reported by the post-session-start expansion and MUST NOT be silently dropped. References that previously matched only MCP tools SHALL receive actionable migration guidance directing users to `mcp_tools`.

#### Scenario: Only built-in tools expanded before spawn

- **WHEN** a profile declares a glob that only matches extension-contributed tools
- **THEN** the pre-spawn resolution contains no results for that glob and does not fail because of it

#### Scenario: Live registry expansion after session start

- **WHEN** the session starts and the extension expands the original references against the live registry
- **THEN** globs cover non-MCP extension tools, and literals without a corresponding non-MCP tool are reported

#### Scenario: tools undeclared

- **WHEN** a profile does not declare `tools` and does not restrict MCP tools
- **THEN** the resolution result contains no tools field, and Pi's current non-MCP tool selection is not otherwise narrowed by the profile

#### Scenario: Existing tools list no longer excludes MCP

- **WHEN** an existing profile declares `tools: ["read"]` and an enabled MCP server offers `search`
- **THEN** `read` and the server's `search` tool are usable; other non-MCP tools absent from `tools` are not enabled by this profile

#### Scenario: Codemode access survives tools selection

- **WHEN** an enabled MCP server offers a tool reachable through Pi's codemode entry point and a profile declares `tools: ["read"]`
- **THEN** the model can invoke that MCP tool through the entry point without the profile also enabling unrelated non-MCP tools

#### Scenario: Deferred access survives tools selection

- **WHEN** an enabled MCP server offers a tool reachable through Pi's deferred discovery entry point and a profile declares `tools: []`
- **THEN** the model can discover and invoke that MCP tool through the entry point without other non-MCP tools becoming active

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

Pi tool references are the exception: they are unknowable before spawn, so they neither fail on a pre-spawn miss nor get recorded as warning items. After session start, missing Pi tool literals SHALL be reported. Literal MCP tool selectors in `mcp_tools` are restrictive policy inputs rather than pre-spawn-resolvable references; they SHALL remain in the policy without a missing-name diagnostic, as specified in "Per-server MCP tool selection".

#### Scenario: Different outcomes for literals and globs

- **WHEN** a profile references both a nonexistent literal skill name and a zero-match skill glob
- **THEN** activation fails because of the literal, while the glob itself only produces a warning item

### Requirement: Narrowing boundary of project-level resources

A profile's skill and extension selection SHALL apply only to user-level resources: resources under the real agentDir and `~/.agents/skills`.

The visibility of project-level resources (project `.pi/skills`, project `.pi/extensions`, ancestor `.agents/skills`) SHALL be decided by Pi's project-trust determination: when the project is trusted they are visible under every profile; when untrusted, visible under none.

Project-level resources not selected by the profile MUST NOT be excluded, and project-level resources selected by the profile MUST NOT thereby be written as additional resource paths. A trusted project's project-level resources SHALL stay in the resolution vocabulary; referencing them MUST NOT fail activation as unmatched and MUST NOT produce zero-match warnings.

A named profile MUST NOT make visible a user-level skill that the user's own settings exclude. The user's `!pattern` and `-path` skill entries SHALL stay effective in a named profile's session, with the same meaning they have under plain Pi.

#### Scenario: Unselected project-level skills stay visible

- **WHEN** the project is trusted, the project contains skill A and skill B, and the active profile declares only A
- **THEN** both A and B are usable in the session

#### Scenario: Project-level references resolve successfully

- **WHEN** the project is trusted and the profile declares skill names, extension IDs, or their globs found in the project
- **THEN** resolution succeeds — neither failing on literals nor producing zero-match warnings

#### Scenario: Project-level resources do not participate when untrusted

- **WHEN** the project is untrusted and the project directory contains skills and extensions
- **THEN** neither appears in the referenceable set nor in the session

#### Scenario: User exclusions stay effective under a named profile

- **WHEN** the user's settings exclude an agentDir skill and a `~/.agents/skills` skill with `!skills/**`, force-include one agentDir skill with `+`, and a named profile declares `skills: ["*"]`
- **THEN** the session shows the force-included skill and neither excluded skill

### Requirement: Per-server MCP tool selection

`mcp_tools` SHALL narrow tools within each explicitly named MCP server, independently of the Pi `tools` field, by exposing only tools matched by the listed selectors and hiding all others. A selector SHALL be a literal tool name as registered by Pi's built-in MCP extension; prefixed or aliased selector spellings from the adapter era SHALL NOT match. The profile-catalog field contract defines which literals are accepted.

A server not named in `mcp_tools` SHALL retain its configured tool availability. An empty object SHALL change nothing. A server mapped to an empty list SHALL offer no callable MCP tools while remaining an enabled server; a nonempty list SHALL permit only tools matched by listed selectors. The profile's per-server policy SHALL replace the server's tool exposure from the merged configuration wholesale: a tool the merged configuration hides SHALL become available only when a selector matches it.

Every server key SHALL resolve to an enabled user-level server in the merged configuration snapshot; an unknown, disabled, or project-only server SHALL fail activation with an error naming the server and usable candidates or the project-scope boundary. An absent or empty `mcp_tools` object SHALL introduce no MCP configuration dependency.

Literal selectors in `mcp_tools` SHALL NOT be checked against a server's tool list or produce missing-name notifications or validation status. A selector matching no tool SHALL remain restrictive: it MUST NOT silently become an unrestricted server. The resulting restriction SHALL hold for direct tools and indirect routes through MCP gateways, proxies, and scripts, including tools added after the initial session start.

#### Scenario: Missing server key defaults to all tools

- **WHEN** an enabled `github` server offers `search` and `delete`, and `mcp_tools` has no `github` entry
- **THEN** both tools remain available, subject to the server's configured tool exposure, regardless of the profile's `tools` list

#### Scenario: Explicit per-server whitelist

- **WHEN** `mcp_tools` sets `github` to `["search"]` and the server offers `search` and `delete`
- **THEN** only `search` is available through direct and indirect MCP tool invocation; `delete` is not exposed or callable

#### Scenario: Prefixed adapter alias no longer matches

- **WHEN** server `fixture` registers original tool `search` and `mcp_tools` sets `fixture` to `["fixture_search"]`, the adapter-era prefixed spelling
- **THEN** no `fixture` tool is exposed, because a selector must be the tool's literal registered name; the restriction remains in force without a missing-name diagnostic

#### Scenario: Empty server list denies all tools

- **WHEN** `mcp_tools` sets `github` to `[]`
- **THEN** no tool offered by `github` can be exposed or called, while the server remains enabled for its non-tool functions

#### Scenario: Server name typo fails before activation

- **WHEN** `mcp_tools` names a server absent from the merged user-level snapshot
- **THEN** activation fails with the name and usable server candidates

#### Scenario: Special-looking unknown server is not discovered

- **WHEN** `mcp_tools` names `toString` or `__proto__` but no such server was defined in the merged snapshot
- **THEN** activation fails with that server name and usable candidates instead of treating the key as implicitly present

#### Scenario: Unmatched literal selector stays restrictive without a diagnosis

- **WHEN** `mcp_tools` lists `serach` for `github` but no registered `github` tool has that name
- **THEN** `search` remains unavailable through direct and indirect MCP tool calls, and the user receives no tool-name validation warning or missing-name status

#### Scenario: Profile policy replaces merged tool exposure

- **WHEN** the merged configuration hides one of a server's tools and `mcp_tools` lists a selector matching that tool
- **THEN** that tool becomes available through direct and indirect MCP tool calls, and every unlisted tool on the server is hidden

#### Scenario: Project-only server is outside the narrowing boundary

- **WHEN** `mcp_tools` names a server defined only by trusted project configuration
- **THEN** activation fails with an explanation that a profile cannot narrow that project-level server, and the project server is unchanged

### Requirement: Subagent override resolution boundaries

Resolution SHALL preserve the profile's validated native subagent declaration without treating its role keys as selectable Resources, registering agents, expanding globs, or applying Resource-reference failure tiering to those keys. Effectively empty declarations SHALL contribute no subagent override to activation.

The declaration alone MUST NOT import pi-subagents, execute extension code, discover agent files, install packages, contact providers, or require child-model authentication. Parent-model validation SHALL retain its existing behavior and MUST NOT be reused to reinterpret child model strings. Final child-model selection, native clearing behavior, runner-specific model handling, and launch failures SHALL remain owned by pi-subagents.

Agent names and advertisement or description declarations MUST NOT enable delegation, alter child prompts directly, or filter unmentioned agents. Existing extension and tool selection SHALL remain the only profile-controlled loading and parent-tool mechanisms in this change.

#### Scenario: Omitted or empty child declarations remain absent from activation

- **WHEN** a profile declares no effective subagent override
- **THEN** activation contains no additional child override and performs no subagent-specific dependency or discovery work

#### Scenario: Child model does not invoke parent-model validation

- **WHEN** a profile declares a child model but no parent model declaration
- **THEN** activation carries the child model string without invoking parent-model authentication or requiring a child-model registry

#### Scenario: Native model syntax is preserved

- **WHEN** a role model contains the native inheritance marker, a provider-qualified model with a thinking suffix, or an external runner's model alias
- **THEN** resolution preserves the nonempty string for pi-subagents rather than translating it into a parent-model declaration

#### Scenario: Unknown role keys are not missing Resource references

- **WHEN** a profile declares an exact role name that is not currently registered
- **THEN** activation retains its override without creating an agent or failing Resource-reference validation, and does not claim that the role exists

#### Scenario: A single role override does not narrow other roles

- **WHEN** a profile overrides only the reviewer and pi-subagents can discover additional roles
- **THEN** the override declaration introduces no availability restriction for the other roles

#### Scenario: Child declaration does not select the extension or tools

- **WHEN** a profile declares subagent overrides without selecting the user-level pi-subagents extension or delegation tools
- **THEN** resolution does not add the extension, grant tools, or alter the existing project-resource boundary
