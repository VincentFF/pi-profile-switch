# pi-profile-switch

[English](README.md) | [中文](README.zh-CN.md)

Named profiles for [Pi](https://github.com/badlogic/pi-mono). A profile references a set of existing skills, extensions, MCP servers, and tools — switch between them in the same Pi process, without restarting.

Use a read-only profile for Q&A and code exploration, a full-powered one for implementation — all against the same installed resources.

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

On install, pi-profile-switch seeds `~/.pi-profile-switch/profiles.json` (global, fallback to `~/.pi/agent/profiles.json` for migration; custom root via `PI_PROFILE_SWITCH_DIR`) with a starter **`ask`** profile — read-only Q&A and code exploration. It assumes nothing about your setup; edit or delete it freely:

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

Project-level profiles live in `<project>/.pi/profiles.json` (trusted projects only). Profiles **reference** resources by name — they never copy them. Installed packages and files in standard locations are discovered automatically; no registration needed. Complete configuration examples live in [`examples/`](examples/): `profiles.json` is the seeded starter above, and `example.json` demonstrates every available field (skills, extensions, MCP servers, tools, model defaults, instructions).

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

## Guarantees

- **Reference, never copy** — profiles point at resources you already own and maintain.
- **Pi-native** — anything a profile doesn't explicitly control keeps plain Pi behavior.
- **Fail safe** — untrusted project directories are never read; a failed switch rolls back to the last working configuration.

## Docs

- [Architecture](docs/architecture/overview.md) · [ADRs](docs/adr/) · [Glossary](CONTEXT.md) (Chinese)
- JSON Schemas: [`schemas/`](schemas/)

## License

MIT
