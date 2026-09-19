# pi-profile-switch

[English](README.md) | [中文](README.zh-CN.md)

Named profiles for [Pi](https://github.com/badlogic/pi-mono). A profile is a named capability bundle you define: skills, extensions, MCP servers, tools (including tools exposed by MCP servers and extensions), model defaults, and extra system-prompt instructions. Switch bundles inside a running Pi session — no restart.

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

Profiles live in two JSON files, both optional:

| File | Scope |
| --- | --- |
| `~/.pi-profile-switch/profiles.json` | Global, all projects. `PI_PROFILE_SWITCH_DIR` overrides the root; `~/.pi/agent/profiles.json` is read as a legacy fallback for migration. |
| `<project>/.pi/profiles.json` | Project-level, trusted projects only. |

Create or change a profile by editing the JSON directly — schema: [`schemas/profiles.schema.json`](schemas/profiles.schema.json).

On install, pi-profile-switch seeds the global file with a starter **`ask`** profile — read-only Q&A and code exploration. It assumes nothing about your setup; edit or delete it freely:

```json
{
  "schemaVersion": 1,
  "profiles": {
    "ask": {
      "label": "Ask & Discuss",
      "description": "Read-only Q&A and code exploration; no file modifications or command execution",
      "skills": [],
      "extensions": [],
      "tools": ["read", "grep", "find", "ls"],
      "instructions": "You are in read-only discussion mode. Answer questions and explain code without modifying any files or running shell commands."
    }
  }
}
```

One profile can use every field at once. This example `impl` profile loads the TDD skill plus your internal skills, the MCP adapter, two MCP servers, an explicit tool allowlist, a pinned model, and standing instructions:

```json
{
  "schemaVersion": 1,
  "profiles": {
    "impl": {
      "label": "Implementation",
      "description": "Full-powered implementation profile: every available field, pinned model",
      "skills": [
        "tdd",
        "internal-*"
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
        "write"
      ],
      "defaultProvider": "anthropic",
      "defaultModel": "claude-sonnet-4-5",
      "defaultThinkingLevel": "high",
      "instructions": "Prefer small, verifiable changes. Run the test suite before claiming completion."
    }
  }
}
```

How fields resolve:

- `skills`, `extensions`, `mcps`, `tools` take names or globs (e.g. `"internal-*"`) referencing resources you already installed or configured — profiles never copy them. Installed packages and files in standard locations are discovered automatically; no registration needed.
- `tools` expands against Pi's live tool registry, so it accepts built-ins, extension-provided tools, and tools exposed by MCP servers.
- `mcps` references servers from your pi-mcp-adapter configuration; connection details stay in the adapter's own config.
- Any field you omit keeps plain Pi behavior.

The files in [`examples/`](examples/) mirror the two profiles above: `profiles.json` is the seeded starter, `example.json` the full-field demo.

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
