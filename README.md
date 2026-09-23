# pi-profile-switch

[English](README.md) | [中文](README.zh-CN.md)

Named profiles for [Pi](https://github.com/badlogic/pi-mono). A profile is a named set of resources you define: skills, extensions, MCP servers, tools (including tools exposed by MCP servers and extensions), model defaults, and extra system-prompt instructions. Switch profiles inside a running Pi session — no restart.

## Install

```bash
npm install -g pi-profile-switch
```

Requires [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) (installed automatically as a peer dependency).

## Quick start

```bash
# Launch with the built-in default profile (all resources, plain Pi behavior)
pi-profile

# Launch with the seeded read-only ask profile
pi-profile ask

# Anything after -- is passed to pi verbatim
pi-profile ask -- --model openai/gpt-5.4
```

## Define your own profiles

Profiles live in two directories, with one JSON file per profile:

| Path | Scope |
| --- | --- |
| `~/.pi-profile-switch/profiles/<name>.json` | Global, all projects. `PI_PROFILE_SWITCH_DIR` overrides the workspace root. |
| `<project>/.pi/profiles/<name>.json` | Project-level, trusted projects only. |

Create or change a profile by editing or creating a `<name>.json` file directly — schema: [`schemas/profiles.schema.json`](schemas/profiles.schema.json).

You can also configure profiles conversationally: the package ships a **`profile-config`** skill (distributed to `<agentDir>/skills/profile-config/` on install) that guides the agent to clarify requirements, discover resources, and write or remove profile files. Profiles created with a `skills` list include `"profile-config"` by default (unless explicitly opted out or covered by a wildcard like `"*"`), keeping configuration available after switching. Details: [`skills/profile-config/SKILL.md`](skills/profile-config/SKILL.md).

On install, pi-profile-switch seeds the global `profiles/` directory with a starter **`ask`** profile (`ask.json`) — read-only Q&A and code exploration. It assumes nothing about your setup; edit or delete it freely:

```json
{
  "label": "Ask & Discuss",
  "description": "Read-only Q&A and code exploration; no file modifications or command execution",
  "skills": [],
  "extensions": [],
  "tools": ["read", "grep", "find", "ls"],
  "instructions": "You are in read-only discussion mode. Answer questions and explain code without modifying any files or running shell commands."
}
```

One profile can use every field at once. This example `impl` profile (`impl.json`) loads the TDD skill, the mcp-scripting skill (shipped by pi-mcp-adapter), and your internal skills; wires up two MCP servers; allows the built-in tools plus both servers' MCP tools by glob; and pins the model and standing instructions:

```json
{
  "label": "Implementation",
  "description": "Full-powered implementation profile: every available field, pinned model",
  "skills": [
    "tdd",
    "internal-*",
    "mcp-scripting"
  ],
  "extensions": [
    "pi-mcp-adapter"
  ],
  "mcps": [
    "github",
    "linear"
  ],
  "tools": [
    "read",
    "grep",
    "find",
    "ls",
    "bash",
    "edit",
    "write",
    "mcp__*",
    "github_*",
    "linear_*"
  ],
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5",
  "defaultThinkingLevel": "high",
  "instructions": "Prefer small, verifiable changes. Run the test suite before claiming completion."
}
```

How fields resolve:

- `skills`, `extensions`, `mcps`, `tools` take names or globs (e.g. `"internal-*"`) referencing resources you already installed or configured — profiles never copy them. Installed packages and files in standard locations are discovered automatically; no registration needed.
- `tools` expands against Pi's live tool registry — built-ins, extension-provided tools, and tools exposed by MCP servers. MCP tools are registered as `mcp__<server>` (proxy) and `<server>_<tool>` (direct tools, the adapter's default `toolPrefix`), so globs like `mcp__*` and `github_*` cover them.
- `mcps` references servers from your pi-mcp-adapter configuration; connection details stay in the adapter's own config.
- Any field you omit keeps plain Pi behavior.

The files in [`examples/`](examples/) mirror the two profiles above: `ask.json` is the seeded starter, `example.json` the full-field demo.

### Migrating from earlier versions

If you used an earlier version that stored all profiles in a single `profiles.json` (`schemaVersion: 1`), migrate manually by creating a file for each profile under the `profiles/` directory:

1. Create directory `~/.pi-profile-switch/profiles/` (or `<project>/.pi/profiles/`).
2. For each key `<name>` in your old `profiles.json`'s `profiles` object, save its value directly as `<name>.json`.
3. Drop the outer `schemaVersion` and `profiles` envelope.

## Commands

In the TUI, the `/profile` command family manages everything in-session:

| Command | What it does |
| --- | --- |
| `/profile` | Interactive profile picker |
| `/profile list` / `/profile status` | Show profiles / active profile details |
| `/profile use <name>` / `/profile reload` | Switch / reload without restarting (rollback on failure) |
| `/profile create\|edit\|delete\|duplicate` | Guided profile CRUD (TUI only) |
| `/profile customize` / `/profile reset` | Narrow the active profile for this session only |

All commands work in non-interactive modes (`--mode rpc|print|json`); CRUD wizards are TUI-only.

## Docs

- [Architecture](docs/architecture/overview.md) · [ADRs](docs/adr/) · [Glossary](CONTEXT.md) (Chinese)
- JSON Schemas: [`schemas/`](schemas/)

## License

MIT
