---
name: profile-config
description: Guides the creation, modification, and deletion of pi-profile-switch profiles. Trigger when the user wants to create, modify, configure, or delete a profile.
---

# profile-config

This skill guides the agent in understanding the user's vague requirements or explicit instructions, and assists in creating, modifying, or deleting `pi-profile-switch` profile files.

> **Notice**: This skill file is distributed by the `pi-profile-switch` package install and is automatically overwritten on package upgrades. Do not modify this file manually.

---

## 1. Core concepts and constraints

### 1.1 Profiles and catalogs
- **Profile**: a named capability definition referencing skills, extensions, MCP servers, and tools, optionally declaring model, thinking level, and instructions.
- **Catalog**: the `profiles/` directory holding profile definitions. Each profile corresponds to one standalone JSON file in the directory: `<name>.json`.
- **default profile**: provided by Pi; cannot be deleted or edited; loads every resource Pi can discover. **Strictly forbidden** to create `default.json` in any profiles directory.

### 1.2 Name charset rules
A profile name must fully match the regex:
```regex
^[A-Za-z0-9][A-Za-z0-9._-]*$
```
- Must start with an ASCII letter or digit.
- Only ASCII letters, digits, dots (`.`), underscores (`_`), and hyphens (`-`) are allowed.
- Spaces, CJK characters, and special symbols are not allowed.

### 1.3 Scopes (source scope) and storage locations
Profile files live in one of two locations:

| Scope | Path | Notes |
| --- | --- | --- |
| **Global** | `$PI_PROFILE_SWITCH_DIR/profiles/<name>.json`<br>(default `~/.pi-profile-switch/profiles/<name>.json`) | Applies to all projects. If the `PI_PROFILE_SWITCH_DIR` environment variable exists and is non-empty, the `profiles/` directory under it is authoritative. |
| **Project** | `<projectDir>/.pi/profiles/<name>.json` | Effective only in the current project, and only when the project is trusted. |

- **Override rule**: a same-named profile in project scope completely replaces the global entry; fields are **not** merged with the global configuration.
- **Project trust gate**: if the current project is untrusted, profiles in project scope cannot resolve, and writes to project scope fail. Before writing to project scope while the project is untrusted, you must tell the user to run `/trust` in the session and restart Pi.

---

## 2. Profile file format and fields

The file content must be formatted JSON, with **the bare definition object at the top level** — strictly no `schemaVersion`, `profiles`, or other outer envelope fields.

All fields are optional. Undeclared fields keep native Pi behavior or current state and produce no side effects.

### Field semantics

| Field | Type | Semantics and constraints |
| --- | --- | --- |
| `label` | `string` | Human-readable display name (e.g. `"Code Review"`). |
| `description` | `string` | Short description of the profile (e.g. `"Read-only review profile"`). |
| `skills` | `string[]` | Skill names or globs to reference. When undeclared, available skills are not narrowed. |
| `extensions` | `string[]` | Extension identifiers or globs to reference. When undeclared, available extensions are not narrowed. |
| `mcps` | `string[]` | MCP server names or globs to reference. When undeclared, there is no dependency on `pi-mcp-adapter`. |
| `tools` | `string[]` | Whitelisted tool names or globs. When undeclared, tools are not narrowed and Pi's native tool set is kept. |
| `defaultProvider` | `string` | Default model provider (e.g. `"anthropic"`, `"openai"`). Effective only when declared together with `defaultModel`. |
| `defaultModel` | `string` | Default model name (e.g. `"claude-sonnet-4-5"`). Effective only when declared together with `defaultProvider`. |
| `defaultThinkingLevel` | `string` | Default thinking level; allowed values: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`. Effective only when the model declaration holds. |
| `instructions` | `string` | Instruction text appended to the system prompt when this profile is active. |

### Example
```json
{
  "label": "Review Mode",
  "description": "Read-only code review with linting and analysis tools",
  "skills": [
    "profile-config"
  ],
  "extensions": [],
  "mcps": [],
  "tools": [
    "read",
    "grep",
    "find",
    "ls"
  ],
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5",
  "defaultThinkingLevel": "high",
  "instructions": "Focus on code quality, security, and edge cases. Do not edit files."
}
```

---

## 3. Discovering referenceable resources

When helping the user configure a profile, check or consult the following locations to discover the resources the user currently has:

1. **Skills**:
   - Discovery locations: `<agentDir>/skills/` and the global `~/.agents/skills/`.
   - Reference identity: Pi's skill name (the `name` declared in the frontmatter of the skill directory's `SKILL.md`, or the directory name).
   - Globs supported (e.g. `"git-*"`).
2. **Extensions**:
   - Discovery locations: installed packages declared in `<agentDir>/settings.json`, and loose files (`.ts` or `.js`) under `<agentDir>/extensions/`.
   - Reference forms:
     - An installed package's package name or source alias.
     - Entry ID of a multi-entry package: `<package>:<relative path>`.
     - Loose-file ID: the path relative to the extension directory minus the `.ts`/`.js` suffix (e.g. `sub/index.ts` is referenced as `sub`).
     - Absolute paths or `~/` paths.
     - Glob matching.
3. **MCP servers**:
   - Discovery locations: the standard configuration locations recognized by `pi-mcp-adapter` — on the global side `~/.config/mcp/mcp.json`, `~/.agents/mcp.json`, `~/.agents/mcp/mcp.json`, `<agentDir>/mcp.json`; trusted projects additionally have `<projectDir>/.mcp.json` and `<projectDir>/.pi/mcp.json`.
   - Reference identity: the server key names under the `mcpServers` object in those configuration files.
   - A profile declaring `mcps` must also ensure the `pi-mcp-adapter` extension is available.
4. **Tools**:
   - Reference identity: tool names in Pi's live tool registry.
   - Includes built-in tools (`read`, `write`, `edit`, `bash`, etc.), extension-contributed tools, and tools exposed by MCP servers (the proxy tool `mcp__<server>` and direct tools `<server>_<tool>`).
   - Globs supported (e.g. `"mcp__*"`, `"github_*"`).
5. **Narrowing boundary of project-level resources (important)**:
   - A profile's resource selection (`skills`, `extensions`) **applies only to user-level resources** (the real agentDir and `~/.agents/skills`).
   - The visibility of project-level resources (project `.pi/skills`, project `.pi/extensions`, ancestor `.agents/skills`) is decided by Pi's project-trust determination: in a trusted project they are always visible under **any** profile; in an untrusted project they are never visible.
   - Therefore project-level resource visibility **does not narrow with profiles** — there is no need, and no guidance, to declare project-level resources in a profile.

---

## 4. Default injection rule at authoring time

When creating or generating a new profile that declares `skills` for the user, follow these conventions:

1. **Inject `"profile-config"` by default**:
   - If the generated profile declares a `skills` array, include `"profile-config"` in the `skills` list by default, so that after switching into the profile the user can still configure profiles through this skill.
   - **Exception 1**: the user explicitly asks not to include `"profile-config"`.
   - **Exception 2**: the `skills` list already contains a covering glob (e.g. `"*"`), so there is no need to add `"profile-config"` explicitly again.
2. **Do nothing when `skills` is undeclared**:
   - If the profile does not declare the `skills` field, skills are not narrowed and every skill (including `profile-config`) is naturally available — never proactively add a `skills` field in that case.

---

## 5. Interaction and execution flows

### 5.1 Create
1. **Clarify requirements**: from the user's natural-language description (e.g. "set up a read-only profile for security auditing"), determine:
   - The target name (validate against `^[A-Za-z0-9][A-Za-z0-9._-]*$`, and not `default`).
   - The target scope (global or project).
   - The tools, skills, extensions, MCP servers, or specific model settings to narrow.
2. **Check resources and environment**: construct a legal JSON definition per the rules above, applying the default injection rule.
3. **Write the file**:
   - Global path: `$PI_PROFILE_SWITCH_DIR/profiles/<name>.json` (default `~/.pi-profile-switch/profiles/<name>.json`).
   - Project path: `<projectDir>/.pi/profiles/<name>.json`.
   - Ensure the directory exists and write formatted JSON.
4. **Tell the user how to take effect**: the new profile is immediately usable via `/profile reload` or `/profile use <name>`.

### 5.2 Edit
1. Read the existing content of the target profile file.
2. Adjust the requested fields per the user's requirements, keeping all other fields intact.
3. Validate and write back formatted JSON.
4. Tell the user to run `/profile reload`.

### 5.3 Delete
1. Confirm the profile to delete exists in the specified scope.
2. Never attempt to delete the `default` profile.
3. Delete the corresponding `<name>.json` file. If the profile is currently in use, remind the user to switch to another profile first (e.g. `/profile use default`).

---

## 6. Boundaries and degradation

1. **Read-only / no `write` tool environments**:
   - If the current session is in a profile with narrowed tools (e.g. a read-only mode without the `write` tool):
   - Degrade to outputting the complete formatted JSON content in the reply along with the suggested absolute file path, and suggest the user save it manually or switch to a profile with file-write capability (e.g. `/profile use default`) before saving.
2. **Untrusted projects**:
   - If a write to project scope (`<projectDir>/.pi/profiles/`) is needed while the current project is not yet trusted:
   - You must explain to the user that an untrusted project cannot take effect, and suggest running `/trust` and restarting Pi, or saving the profile to global scope instead.
