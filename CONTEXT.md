# Glossary

## Domain terms

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Profile** | A named capability definition: references skills, extensions, MCP servers, and tools; optionally declares model, thinking level, and instructions. | preset, config, bundle, capability |
| **default profile** | The built-in profile: not deletable, absent from catalog files; loads every resource Pi can discover. | built-in |
| **Catalog** | The `profiles/` directory holding profile definitions: one global, one per project, one `<name>.json` file per profile. | — |
| **Source scope** | Where a profile comes from: `builtin`, `global`, or `project`. Determines which scope its runtime state and edits are written to. | — |
| **RuntimeOverlay** | A temporary narrowing of the active profile: disables resolved skills, extensions, or MCP servers, or replaces the tool reference set. Usually just "overlay". | session profile, temporary profile |
| **Runtime state** | The persisted active-profile selection and overlay. | — |
| **Resource** | Anything a profile can reference: a skill, extension, MCP server, or tool. | — |
| **Project trust** | Pi's trust decision about a project directory; determines whether the project-level catalog and project resources participate in resolution. | — |
| **pi-mcp-adapter** | The optional Pi package that owns MCP server configuration, connections, and credentials. | — |

## Internal terms

| Term | Meaning | Avoid |
| --- | --- | --- |
| **ActivationPlan** | The immutable resource and tool set resolved from one profile plus one overlay; produced by ProfileResolver. | — |
| **SkillRegistry** | Mapping from skill name to the winning `SKILL.md`; mirrors Pi's full discovery result. | — |
| **ExtensionDiscovery** | The referenceable view of extensions: installed packages and loose files in standard directories. Pure discovery, no registration layer. | — |
| **McpServerRegistry** | MCP server names and states as discovered by `pi-mcp-adapter`. | — |
| **instance** | The runtime directory `pi-profile-switch` generates for one Pi process, handed to Pi via `PI_CODING_AGENT_DIR`. | — |
| **Generated settings** | The `settings.json` written into the instance; encodes the profile's resource selection as native Pi settings. | — |
| **Runtime reload** | Pi natively re-reads settings and rebuilds resources while preserving the current session. | — |
| **Adoption** | A sweep disposition: an unrecognized entry whose content scan confirms it does not reference its own instance path is moved into the real agentDir; after adoption, the next launch turns it into a symlink via mirroring (ADR-0012). | absorption |
