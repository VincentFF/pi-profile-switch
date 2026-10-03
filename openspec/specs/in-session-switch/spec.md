# in-session-switch Specification

## Purpose
Defines the behavior of the `/profile` command family inside the Pi process: how switching replaces resources without restarting the process, how failures return to the pre-switch state, the overlay's scope and lifecycle, and where runtime state is written.

## Requirements

### Requirement: /profile command family

`/profile` SHALL accept these subcommands: bare invocation (opens the selector), `use`, `reload`, `status`, and `overlay`.

Unknown subcommands SHALL be rejected with a usage note naming the accepted set. `use` without a name SHALL be rejected with that subcommand's usage.

All forms SHALL be available in every mode, including non-TUI modes; the bare selector's behavior outside TUI mode is defined by the observability surface.

#### Scenario: Unknown subcommand

- **WHEN** `/profile frobnicate` is executed
- **THEN** the operation is rejected and a usage note naming the accepted subcommands is printed

#### Scenario: use without a name

- **WHEN** `/profile use` is executed without a name
- **THEN** the operation is rejected with the `use` usage note

#### Scenario: Non-TUI availability

- **WHEN** `/profile status` or an `/profile overlay` form is executed in a non-TUI mode
- **THEN** it executes normally and is not rejected for the mode

### Requirement: In-session switching

`/profile use <name>` SHALL execute in order: wait for the current agent turn to finish, snapshot the runtime files, re-resolve the target profile through the full launch path, rewrite the runtime files in place, and trigger Pi's native reload.

Waiting SHALL use Pi's native idle wait and MUST NOT interrupt an in-flight turn.

Re-resolution SHALL include the same validation as the launch path: trust determination, catalog read, resource discovery, model and MCP validation. When resolution fails, NO runtime file SHALL be written and the runtime stays in its pre-switch state.

Switching SHALL NOT restart the Pi process; the current session's sessionId and message history SHALL remain unchanged.

Switching SHALL NOT change Pi's project-trust input: the instance's `trust.json` link form is identical before and after a switch, so project-level resource visibility stays stable within one process. Post-switch project-level visibility SHALL match launching directly with the target profile and MUST NOT require a process restart to take effect.

`/profile use` SHALL persist the selection and SHALL discard the pre-switch profile's overlay.

`/profile reload` SHALL follow the same path, but SHALL NOT produce a change summary and SHALL preserve the current profile's existing selection persistence (a one-shot selection made at launch remains one-shot after reload).

An explicit empty `mcps` selection SHALL have the same effect after `/profile use` and `/profile reload` as at launch: the rewritten instance configuration disables every user-level server in the merged snapshot. Switching to a profile that omits `mcps` SHALL restore the merged snapshot's full user-level server availability.

#### Scenario: Successful switch

- **WHEN** `/profile use implement` is executed and both resolution and reload succeed
- **THEN** the runtime files are rewritten with that profile's resolution result and the session is not interrupted

#### Scenario: Project-level visibility unchanged by switching

- **WHEN** the project is trusted, started with a named profile, and `/profile use default` is executed
- **THEN** project-level skills and extensions are visible under both profiles, the process is not restarted, and sessionId and message history are unchanged

#### Scenario: Failure at resolution stage

- **WHEN** the target profile's references cannot resolve
- **THEN** the operation fails reporting the cause, and no runtime file is modified

#### Scenario: Reload preserves one-shot selection

- **WHEN** launched as `pi-profile review` (one-shot selection), followed by `/profile reload`
- **THEN** `review` is still running and the selection is not thereby written into runtime state

#### Scenario: Switching to an empty MCP selection

- **WHEN** a session switches from a profile that omits `mcps` to a named profile declaring `mcps: []`
- **THEN** the user-level servers from the merged snapshot are unavailable without restarting the Pi session

#### Scenario: Empty MCP selection survives reload

- **WHEN** a named profile with `mcps: []` executes `/profile reload`
- **THEN** the user-level servers from the merged snapshot remain unavailable

#### Scenario: Switching back to omitted MCP selection

- **WHEN** a session switches from a named profile with `mcps: []` to a profile omitting `mcps`
- **THEN** user-level servers return to their merged-snapshot availability

### Requirement: Rollback on switch failure

When rewriting runtime files or reloading fails, the runtime files from the snapshot SHALL be restored and the failure cause reported. If a reload was attempted or Pi might have observed rewritten files, the restored files SHALL be reloaded. The runtime MUST NOT remain in a half-switched state.

Pi's interactive mode may swallow a reload rejection or failure without reporting it. A switch SHALL therefore verify after reload that it actually executed; when that cannot be proven, it SHALL be treated as a failure and rolled back.

Restoration SHALL reproduce the snapshot exactly: nonexistence, symlink targets, file content, and permission bits are all restored, and writes MUST NOT go through leftover symlinks into link targets.

Persistence of selection and overlay SHALL happen in the post-reload extension instance, so rollback MUST NOT need to undo state-file writes.

#### Scenario: Reload throws

- **WHEN** reload throws an error
- **THEN** the runtime files are restored to their pre-switch content and reloaded again, and the error states that the target profile failed to activate and why

#### Scenario: Reload silently skipped

- **WHEN** reload neither errors nor actually re-executes the extension
- **THEN** it is treated as a failure and rolled back, reporting that reload did not execute

#### Scenario: Write fails after one managed file changes

- **WHEN** switching a profile changes a managed runtime file and a later write fails before reload
- **THEN** every managed runtime file is restored to its exact pre-switch state, selection and overlay remain unchanged, and the failed profile is not reported as active

### Requirement: Session-start plan application and change summary

Every session start (launch, reload, new, resume, fork) SHALL apply the plan in the current runtime directory. When `tools` is declared, the active tool set SHALL combine its original references expanded against Pi's live non-MCP registry with the MCP-owned tools available under the server and per-server tool selections, plus the native entry points needed to reach enabled MCP tools. When `tools` is absent, Pi's current tool availability SHALL stay unchanged; overlay disabled tool entries still narrow their established base. An absent or empty `mcp_tools` object MUST NOT by itself change Pi's tool state.

When the plan carries disabled tool entries from the overlay, the active tool set SHALL subtract their matches at that moment. The base for overlay resolution SHALL remain the profile's resolved Pi tool references when `tools` is declared, or the runtime's available tool set when it is not; per-server MCP tool filtering SHALL be governed by `mcp_tools` and server selection.

Pi tool literals with zero matches against the applicable live registry SHALL be reported as warnings and MUST NOT be silently dropped. Literal selectors in `mcp_tools` SHALL remain restrictive without a missing-name diagnostic, as specified in "Per-server MCP tool selection" in the resource-reference specification.

When the plan marks the selection for persistence and this session start was triggered by a reload, the active profile SHALL be written to the state file of that profile's source scope.

The change summary produced by a switch SHALL be injected into the next agent turn and SHALL appear exactly once: the mark is cleared after injection and later reloads do not repeat it.

#### Scenario: Tools whitelist re-applied after reload

- **WHEN** the new extension instance executes session start after reload
- **THEN** the active non-MCP tool set is reset to the original references expanded against the live registry, while available MCP-owned tools and their native discovery entry points remain independent of those references

#### Scenario: Built-in MCP extension does not own sibling extension tools

- **WHEN** a profile declares `tools: []`, MCP servers provide tools through Pi's built-in MCP extension, and an unrelated extension registers a tool
- **THEN** the unrelated extension's tool is not active after session start or reload, while MCP tools permitted by MCP policy and their native discovery entry points remain available

#### Scenario: Codemode and deferred access after switch

- **WHEN** the session switches to a profile with `tools: ["read"]` and an enabled server has tools reachable through Pi's codemode or deferred discovery entry points
- **THEN** the model can use both kinds of MCP tool after reload without `tools` explicitly listing either entry point

#### Scenario: Disabled tools stay disabled across reload

- **WHEN** the overlay has disabled a tool and a reload occurs
- **THEN** the tool is absent from the active tool set after session start re-applies the plan

#### Scenario: Change summary appears exactly once

- **WHEN** `/profile reload` is executed after a successful switch
- **THEN** only the first turn after the switch receives the change summary

#### Scenario: State write does not overwrite the overlay

- **WHEN** the post-reload instance writes the active profile per the plan
- **THEN** an overlay already in the state file remains unchanged, unless this switch explicitly requested discarding it

#### Scenario: Profile switch changes per-server MCP tool policy

- **WHEN** `/profile use review` switches from a profile allowing all `github` tools to one listing only `search`
- **THEN** the existing Pi session retains its identity and history, and `github` tools other than `search` are no longer callable, including via indirect MCP calls

#### Scenario: Empty MCP list survives reload

- **WHEN** a profile with `mcp_tools: { "github": [] }` reloads
- **THEN** the server remains enabled and no `github` tool becomes callable after the reload

### Requirement: Runtime overlay

The overlay SHALL apply only to the current runtime and MUST NOT be written to any catalog file.

The overlay SHALL be able to disable skills, extensions, MCP servers, and tools, through one uniform grammar: `/profile overlay disable|enable skill|extension|mcp|tool <name-or-glob>`. For tools, the set an entry disables from SHALL be the profile's resolved tool references when the profile declares `tools`, and the runtime's available tool set when it does not.

Disable entries SHALL be names or globs, stored as written and re-expanded at every resolution. An unmatched literal SHALL fail and identify the entry. A zero-match glob SHALL NOT fail; it SHALL be surfaced as a warning, following the failure tiering of profile references (ADR-0009).

`/profile overlay disable|enable` SHALL first re-resolve with the candidate overlay (validation happens here), then switch and reload, and only then write the overlay to the state file. When the switch fails, the stored overlay SHALL remain unchanged.

`enable` SHALL remove a stored entry by exact string match; when no stored entry matches, it SHALL fail listing the current entries of that kind.

`/profile overlay clear` SHALL first switch and reload without the overlay, then delete the overlay from the state file. When the switch rolls back, the stored overlay SHALL still match the restored runtime.

Startup SHALL ignore a stored overlay: an overlay MUST NOT survive across runtimes.

The `default` profile does not filter by default. When narrowed by an overlay it SHALL become an "all resources minus the disabled entries" selection, so its skills, extensions, and tools can all be disabled. MCP disabling on the `default` profile SHALL be rejected — it has no MCP whitelist to narrow.

#### Scenario: Overlay does not touch the catalog

- **WHEN** `/profile overlay disable skill git-commit` is executed
- **THEN** that skill is no longer active in the current runtime and the catalog file content is unchanged

#### Scenario: Disabling an unresolved resource

- **WHEN** disabling a literal skill, extension, MCP server, or tool name that the current profile has not resolved
- **THEN** the operation fails with an error identifying the entry

#### Scenario: Disabling a tool narrows the active tool set

- **WHEN** `/profile overlay disable tool bash` is executed
- **THEN** `bash` is no longer part of the active tool set in the current runtime

#### Scenario: Tool disable on a profile without declared tools

- **WHEN** the active profile declares no `tools` and `/profile overlay disable tool bash` is executed
- **THEN** the runtime's available tool set minus `bash` becomes active

#### Scenario: Removed tools replace-form is rejected

- **WHEN** `/profile overlay tools read grep` is executed
- **THEN** the operation is rejected with the overlay usage note, and the stored overlay is unchanged

#### Scenario: Zero-match glob succeeds with a warning

- **WHEN** `/profile overlay disable skill git-*` matches no resolved skill
- **THEN** the entry is stored, the operation succeeds, and a warning reports the zero-match glob

#### Scenario: Stored glob is re-expanded on reload

- **WHEN** the overlay stores `git-*` and a later reload resolves a new skill matching that glob
- **THEN** the re-expanded overlay disables the new skill as well

#### Scenario: Enable removes a stored entry

- **WHEN** the stored overlay disables `git-*` and `/profile overlay enable skill git-*` is executed
- **THEN** the entry is removed and the matching resources become active again

#### Scenario: Enable without a matching stored entry

- **WHEN** `/profile overlay enable skill git-commit` is executed and no stored skill entry equals that string
- **THEN** the operation fails listing the current skill disable entries

#### Scenario: Reset restores the definition

- **WHEN** `/profile overlay clear` is executed while an overlay exists
- **THEN** the runtime returns to the profile definition's content and the overlay is deleted from the state file

#### Scenario: MCP disabling on the default profile is rejected

- **WHEN** an overlay disabling some MCP server is applied to the `default` profile
- **THEN** the operation fails with an error explaining that the profile has no MCP whitelist to narrow

### Requirement: Runtime state

Runtime state SHALL live in a state file: `<projectDir>/.pi/pi-profile-state.json` for project scope, and `pi-profile-state.json` under the workspace root for global scope.

The write location SHALL be decided by the active profile's source scope; the built-in `default` SHALL count as global scope.

State SHALL hold two items — the active profile and the overlay — updatable independently: writing one MUST NOT erase the other.

A missing or corrupt state file SHALL be read as empty state and MUST NOT produce an error. Other read failures SHALL propagate.

#### Scenario: Updating the active profile preserves the overlay

- **WHEN** state already holds an overlay and a switch then updates only the active profile
- **THEN** the overlay is still in the state

#### Scenario: Corrupt state file

- **WHEN** the state file's content is not legal JSON
- **THEN** the read yields empty state and neither launch nor switching fails because of it

### Requirement: Observability surface

Bare `/profile` SHALL open the interactive selector over the visible profiles; outside TUI mode it SHALL degrade to printing the profile list, with the structured payload serving non-interactive consumers.

The selector and the degraded list SHALL show only visible profiles and SHALL use the same trust gating as activation: profiles from an untrusted project MUST NOT appear.

Each list entry SHALL report the winning definition's source and be marked when the project definition shadows a same-named global definition.

`/profile status` SHALL report the active profile, the stored overlay, resolved resources and paths, the MCP server tri-state (enabled, discovered but not enabled, referenced but not discovered), and same-named tool or command conflicts with their actual winners. For a named profile declaring `mcps: []`, the discovered user-level servers in the merged snapshot SHALL be reported as disabled, not enabled, while trusted project-owned servers SHALL remain reported as enabled.

The degraded list and `status` SHALL be emitted as messages carrying structured payloads for non-interactive consumers.

#### Scenario: Untrusted project's profiles are invisible

- **WHEN** the project is untrusted and profiles exist in the project catalog
- **THEN** neither the selector nor the list shows those profiles

#### Scenario: Same-named project definition shadows the global one

- **WHEN** the project and global catalogs define the same-named profile
- **THEN** the list entry reports its source as project and is marked as shadowing the global definition

#### Scenario: Empty MCP selection is visible in status

- **WHEN** a named profile declares `mcps: []` and user-level servers have been discovered in the merged snapshot
- **THEN** `/profile status` reports no selected user-level servers and reports the discovered user-level servers as disabled

#### Scenario: Project-owned server remains enabled in status

- **WHEN** a named profile declares `mcps: []` and a trusted project defines an enabled server
- **THEN** `/profile status` reports the project-owned server as enabled rather than disabled

### Requirement: MCP tool policy status and switch rollback

`/profile status` SHALL show which enabled servers have unrestricted, explicitly restricted, or no MCP tools, including the declared selectors for explicitly restricted servers; it SHALL NOT report selector validity or missing-name candidates. When `mcps` is undeclared, a server the merged user-level configuration marks `enabled: false` SHALL appear as discovered but not enabled, rather than enabled. A switch or reload failure while applying a per-server restriction SHALL restore the previous MCP and Pi tool availability, not leave a partial policy.

#### Scenario: Status distinguishes absent and empty lists

- **WHEN** an active profile omits `github` from `mcp_tools` and explicitly sets `linear` to `[]`
- **THEN** `/profile status` reports `github` as unrestricted and `linear` as having no enabled MCP tools

#### Scenario: Status respects merged-config-disabled servers without an MCP whitelist

- **WHEN** `mcps` is undeclared and the merged user-level configuration marks `linear` with `enabled: false` while `github` is enabled
- **THEN** `/profile status` reports `github` as enabled and `linear` as discovered but not enabled, without listing `linear` as an unrestricted enabled server

#### Scenario: Failed switch restores previous tool policy

- **WHEN** a profile switch fails during reload after writing a different per-server tool policy
- **THEN** the prior runtime files and tool availability are restored, and the cause is reported
