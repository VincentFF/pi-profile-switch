# pi-profile-switch

[English](README.md) | [中文](README.zh-CN.md)

Named profiles for [Pi](https://github.com/badlogic/pi-mono). A profile is a named set of resources you define: skills, extensions, MCP servers, tools, per-server MCP tool selections (`mcp_tools`), model defaults, and extra system-prompt instructions. Switch profiles inside a running Pi session — no restart.

## Install

```bash
npm install -g pi-profile-switch
```

Requires [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 0.99.1 or newer (installed automatically as a peer dependency). Use `npm install -g`, not `pi install` — this package provides the `pi-profile` launcher.

## Quick start

```bash
# Built-in default profile: all resources, plain Pi behavior
pi-profile

# Starter read-only ask profile
pi-profile ask

# Anything after -- is passed to pi verbatim
pi-profile ask -- --model openai/gpt-5.4
```

## Define your own profiles

Profiles live in two directories, one JSON file per profile:

| Path | Scope |
| --- | --- |
| `~/.pi-profile-switch/profiles/<name>.json` | Global, all projects. `PI_PROFILE_SWITCH_DIR` overrides the root directory. |
| `<project>/.pi/profiles/<name>.json` | Project-level, trusted projects only. Completely replaces a global profile with the same name. |

Write the JSON directly (schema: [`schemas/profiles.schema.json`](schemas/profiles.schema.json)), or configure profiles conversationally: the package ships a [`profile-config`](skills/profile-config/SKILL.md) skill that creates, edits, and deletes profiles. Profiles created with a `skills` list include `"profile-config"` by default (unless you opt out or cover it with a wildcard like `"*"`), keeping configuration available after switching.

When the global profiles directory has no profile yet, pi-profile-switch writes a starter **`ask`** profile — read-only Q&A and code exploration. It assumes nothing about your setup; edit or delete it freely. See [`examples/ask.json`](examples/ask.json).

A profile example:

```json
{
  "label": "Implementation",
  "description": "Implementation resources and startup model defaults",
  "skills": ["tdd", "internal-*"],
  "mcps": ["github", "linear"],
  "tools": ["read", "grep", "find", "ls", "bash", "edit", "write"],
  "mcp_tools": {
    "github": ["search", "get_issue"],
    "linear": []
  },
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5",
  "defaultThinkingLevel": "high",
  "instructions": "Prefer small, verifiable changes. Run the test suite before claiming completion.",
  "subagents": {
    "defaultModel": "anthropic/claude-sonnet-4-5",
    "agentOverrides": {
      "reviewer": {
        "thinking": "high",
        "description": "Independent review for this project",
        "advertise": true
      }
    }
  }
}
```

Use the [schema](schemas/profiles.schema.json) for supported fields and shapes. For activation and diagnostics, see:

- `skills`, `extensions`, `mcps`, `tools` take names or globs (e.g. `"internal-*"`) referencing resources you already installed or configured — profiles never copy them. Installed packages and files in standard locations are discovered automatically; no registration needed.
- `tools` expands strictly against Pi's non-MCP tool registry — built-ins and extension-contributed tools, attributed by registration ownership (`sourceInfo`). Available MCP tools remain usable independently of `tools`. When a profile declares `tools` and at least one MCP server is enabled, Pi's native MCP discovery entry points (`codemode` and `tool_search`) stay active even if you did not list them; unrelated non-MCP tools excluded by `tools` stay excluded.
- `mcp_tools` defines per-server MCP tool filtering: keys are literal configured server names and values are literal MCP tool names as exposed by Pi's built-in MCP extension. Globs are not accepted. An omitted server keeps native access to all its tools; a nonempty array allows only matched tools; an empty array (`[]`) denies all tools for that server while leaving it enabled. Unmatched selectors remain restrictive and are not diagnosed, so confirm selectors with the server before writing them.
- **Migration notes:**
  - Former MCP references in `tools` (e.g. `mcp__*`, `<server>_*`) no longer govern MCP access. Move desired MCP tool restrictions to `mcp_tools`.
  - Prefixed selectors (e.g. `<server>_<tool>` forms used by previous MCP integrations) no longer apply; replace them with the literal tool names from Pi's built-in MCP extension.
- `mcps` references servers from your Pi user-level MCP configuration (`~/.config/mcp/mcp.json`, `~/.agents/mcp.json`, `~/.agents/mcp/mcp.json`, and `<agentDir>/mcp.json`); connection details stay in those files.
  - **Omitting `mcps`** leaves all discovered user-level servers at their normal availability.
  - **`mcps: []`** disables every discovered user-level server, including agentDir-only servers; every unselected user-level server keeps its full definition and is explicitly marked `enabled: false` in the generated instance `mcp.json`. Project-level servers are never narrowed.
  - Trusted project-level MCP servers are always kept enabled and are never narrowed by `mcps`.
  - A later user-level source replaces a same-named server from an earlier source in full (no field-wise merging), so connection and credential fields are never inherited across files.
- The instance `mcp.json` is always a generated snapshot of the merged user-level configuration. In-session `pi mcp add` edits the instance copy, and the next `/profile use` or `/profile reload` overwrites it with the profile's snapshot.
- Any field you omit keeps plain Pi behavior.
- `label` and `description` are display metadata. `defaultProvider` and `defaultModel` (declared together) set the startup model; `defaultThinkingLevel` sets its thinking level; `instructions` is appended to the system prompt.
- `subagents` optionally supplies native pi-subagents model/thinking defaults and exact role overrides. It does not load pi-subagents or change which roles or tools are available. Role descriptions are metadata, not child prompts; `advertise` controls parent-prompt listing, not whether a role can run. `/profile status` shows declared inputs, while `/subagents-models` inspects the native live mapping. See the [subagent behavior contract](openspec/specs/launcher/spec.md) and [pi-subagents model documentation](https://github.com/nicobailon/pi-subagents/blob/main/docs/models.md).
- `skills`, `extensions`, `mcps`, and `tools` reference installed resources by name or glob; profiles never copy resources. `tools` covers non-MCP tools only (built-ins and extension tools).
- `mcp_tools` selects tools inside MCP servers by literal server and tool name — globs are rejected. Omit a server to leave it unchanged, use `[]` to deny all of its tools while keeping the server enabled, or list names to allow only those. A literal selector that matches nothing stays restrictive without warning; missing or dormant server declarations follow the reference failure contract below.
- `mcps` names user-level servers from `~/.config/mcp/mcp.json`, `~/.agents/mcp.json`, `~/.agents/mcp/mcp.json`, and `<agentDir>/mcp.json`. Omit it to leave all servers as configured; use `[]` to disable every user-level server. Project-level servers (`.pi/mcp.json`) are read by Pi itself and are never narrowed. MCP transport usability is decided by native Pi.
- Older profiles expressed MCP tool access through `mcp__*` or `<server>_*` entries in `tools`; use `mcp_tools` instead.
- Every omitted field keeps plain Pi behavior.

- [Selected-definition validation](openspec/specs/profile-catalog/spec.md#requirement-catalog-file-format-validation) and [field diagnostics](openspec/specs/profile-catalog/spec.md#requirement-profile-definition-fields).
- [Reference failure tiering](openspec/specs/resource-reference/spec.md#requirement-unified-failure-tiering-for-references) and [per-server MCP tool selection](openspec/specs/resource-reference/spec.md#requirement-per-server-mcp-tool-selection).
- [Restrictive partial materialization](openspec/specs/launcher/spec.md#requirement-restrictive-partial-materialization) and [native model declaration handoff](openspec/specs/launcher/spec.md#requirement-native-model-declaration-handoff).
- [Profile listing and status diagnostics](openspec/specs/in-session-switch/spec.md#requirement-observability-surface).

After editing, run `/profile reload` and inspect `/profile status`. Fix reported definition errors; use reference warnings to repair resource names or install the intended resources without erasing the selection. Check model availability through native Pi after its extensions load.

**Migration notes:**
- Former MCP references in `tools` (for example `mcp__*` or `<server>_*`) no longer govern MCP access. Move restrictions to `mcp_tools`.
- Replace adapter-era prefixed selectors with literal server tool names from Pi's own MCP interface.

Edit your real MCP configuration rather than the generated instance copy. See the [instance snapshot contract](openspec/specs/launcher/spec.md#requirement-instance-mcp-configuration-snapshot) for in-session edits.

[`examples/`](examples/) contains the full example above and the starter `ask`.

## Commands

| Command | What it does |
| --- | --- |
| `/profile` | Show the available profiles and pick one (interactive selector; prints the list outside the TUI). |
| `/profile use <name>` | Switch profiles now. The session reloads with the new resources; a failed switch rolls back. The choice is remembered for the next launch. |
| `/profile reload` | Re-read the active profile file after editing it. |
| `/profile status` | Report the active profile, resolved resources and paths, overlay, MCP server state, and conflicts. |
| `/profile overlay disable\|enable skill\|extension\|mcp\|tool <name-or-glob>` | Narrow or restore resources for this session only. |
| `/profile overlay clear` | Drop the overlay and use the profile as written. |

All forms work in every mode, including non-interactive ones (`--mode rpc|text|json`); the bare selector degrades to the profile list where no interactive UI exists. The overlay is a runtime-only narrowing: it is never written to a catalog file and never survives a restart. Tools follow the same disable/enable model as the other resource kinds: a tool `disable` entry narrows the profile's resolved tool references — or the runtime's full available tool set when the profile declares no `tools`.
All of these work in every mode, including non-interactive ones (`--mode text`, `--mode json`, `--mode rpc`). An overlay lives only in the current runtime: it is never written to your profile files and is gone after a restart. Disabling MCP servers with an overlay is not possible on the built-in `default` profile — it has no server list to narrow.

## Migration: undeclared resource fields

Earlier releases treated an omitted `skills` or `extensions` field as an empty selection, hiding that kind. Omission now keeps Pi's native visibility for that kind, so a profile that relied on the old behavior can expose more resources after upgrading.

To hide a kind, declare it explicitly empty instead of omitting it:

```json
{
  "skills": [],
  "extensions": []
}
```

The authoritative selection contract is [Sparse skill and extension selection](openspec/specs/resource-reference/spec.md).

## Docs

- Field reference: [`schemas/profiles.schema.json`](schemas/profiles.schema.json)
- Architecture and terminology: [`docs/architecture/overview.md`](docs/architecture/overview.md) and [`CONTEXT.md`](CONTEXT.md)
- Decisions: [`docs/adr/`](docs/adr/)
- Authoring guide: [`skills/profile-config/SKILL.md`](skills/profile-config/SKILL.md)

## License

MIT
