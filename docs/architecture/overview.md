# pi-profile-switch Architecture

## Overall structure

Two processes communicating through files in the instance directory — no shared memory.

```text
┌──────────────────────────────────────┐
│  pi-profile launcher (Node, parent)  │
│  bin/pi-profile.ts + src/launcher/   │
└────────────────┬─────────────────────┘
                 │ resolve profile → resolve resources → materialize instance
                 │ spawn: PI_CODING_AGENT_DIR=<instance>  -e <extension>  <user args verbatim>
                 ▼
┌──────────────────────────────────────┐
│  pi (child process, real Pi binary)  │
│  ┌────────────────────────────────┐  │
│  │  pi-profile extension          │  │
│  │  extensions/pi-profile/index.ts│  │
│  │  /profile commands · switching │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

There are only three external interfaces: CLI arguments, the `/profile` commands, and the catalog schema. Resource filtering itself is executed by Pi's native settings mechanism (ADR-0005); pi-profile implements no filtering of its own.

The only channel between launcher and extension is the instance directory: the launcher writes `settings.json`, `pi-profile.json`, `mcp.json`, and `APPEND_SYSTEM.md`; the extension reads `pi-profile.json` at `session_start` to obtain the ActivationPlan for this run. For in-session switching, the extension rewrites the same files in place and triggers `ctx.reload()`; Pi re-reads from disk — this is why switching needs no process restart (ADR-0005).

## Filtering model

A profile takes over exactly four resource categories (skills, extensions, MCP servers, tools); every other category passes through untouched. Each category is implemented with a mechanism Pi already has — no new interception layer. Narrowing applies only to user-level resources (the real agentDir and `~/.agents/skills`); project-level resources are governed by Pi's project-trust determination, as shown in the table.

| Scope | Pi mechanism | Form |
| --- | --- | --- |
| agentDir level (`skills`, `extensions`) | The discovery root moves with `PI_CODING_AGENT_DIR`, so these are naturally not discovered; settings arrays carry the absolute paths of selected entries | Whitelist (attached paths) |
| `~/.agents/skills` (HOME level, cannot be suppressed) | Always auto-discovered, so the settings array carries `-<absolute path>` to force-exclude unselected entries | Complement exclusion |
| Project level (`.pi/skills`, `.pi/extensions`, ancestor `.agents/skills`) | Owned by Pi: the instance's `trust.json` link points at the real trust store, and Pi auto-discovers per stored decisions. A named profile's generated settings still set `defaultProjectTrust: "never"`, but that only suppresses the trust prompt (stored decisions take precedence over it). The narrowing contract is in `openspec/specs/resource-reference/spec.md`, "Narrowing boundary of project-level resources" | Not narrowed by profiles |
| packages (user-configured packages) | The settings `packages` array is rewritten in object form with per-type allowlist globs | Whitelist |
| packages (project) | Read natively by Pi from the project `.pi/settings.json` and installed under the project `.pi/npm`; generated settings do not merge project settings, so they never become an install side effect of the global npm root | Native |
| tools | Settings `defaultTools` as the built-in tool boot baseline; after `session_start` and reload, the extension expands the tool references from `pi-profile.json` against Pi's live registry and calls `setActiveTools` | Whitelist |
| MCP servers | The instance's `mcp.json` keeps only the allowed servers and explicitly marks unselected user-level shared servers as disabled; servers from project `.mcp.json` / `.pi/mcp.json` are not narrowed by profiles. When `mcps` is undeclared, the real `mcp.json` is symlinked | Whitelist (file filtering) |
| prompts, themes (not taken over) | User arrays kept verbatim, re-including the corresponding directories of the real agentDir; the project-level portion is discovered natively by Pi | Pass-through |

The `default` profile generates no filtering at all: settings are a verbatim copy of the user's global settings, re-including the real agentDir's `skills`/`extensions`/`prompts`/`themes` directories (because the discovery root has moved), do not set `defaultProjectTrust`, and behave identically to native Pi.

## Modules and interfaces

### CLI and launcher (outside the pi process)

| Module | Interface |
| --- | --- |
| `bin/pi-profile.ts` | Entry point. Consumes the first positional argument (profile name) and the `--` that follows it; everything else becomes pi's argv verbatim |
| `launcher/args.ts` | `parseLauncherArgs(argv)` → `{ profile, piArgs, trustOverride }`; `--approve`/`--no-approve` are rewritten into trust input |
| `launcher/initial-profile.ts` | Positional argument or saved active profile → `InitialProfile`; unknown profiles fail here |
| `launcher/discovery.ts` | `discoverLauncherResources()` → launcher-side read-only discovery result (skills, package roots) for the resolver |
| `launcher/model-check.ts` | `checkDeclaredModel(agentDir, model)` → error message or undefined |
| `launcher/spawn.ts` | Result of `generateRuntimeDir` + user arguments → spawn pi, write the `pid` liveness file, forward signals and exit code |
| `launcher/runtime-cleanup.ts` | Sweeps stale instance directories by `pid` liveness at startup; routes unrecognized entries by content scan (adopt / delete / keep-with-warning) |

### Resolution (shared by launcher and in-session)

| Module | Interface |
| --- | --- |
| `profile-catalog.ts` | Catalog read side: `ProfileCatalog` lists and parses winning definitions, producing `ResolvedProfile` (with `source: builtin \| global \| project`) |
| `profile-catalog-store.ts` | Catalog write side (`profiles/<name>.json`), used only by the TUI CRUD path |
| `project-trust.ts` | `resolveProjectTrust(input)` → boolean; mirrors Pi's decision order; decides whether pi-profile reads the project catalog, project state, and project MCP configuration (project-level resources themselves belong to Pi) |
| `skill-registry.ts` | `discoverSkills(options)` → `SkillEntry[]`; read-only calls into Pi SDK discovery, never scans directories itself |
| `extension-discovery.ts` | `discoverExtensions(options)` → `DiscoveredExtensions` (read-only, never executes extension code); `.select(refs)` resolves package names, aliases, loose-file stems, globs, and absolute paths |
| `mcp-config.ts` | `discoverAdapterServerNames()` → server names configured in the adapter; `loadMergedMcpServers()` feeds instance `mcp.json` generation |
| `profile-resolver.ts` | `resolveProfile(input)` → immutable `ActivationPlan` (skills, extensions, tools, MCP, model, instructions, `unmatched`, `filter`) |

### Materialization and state

| Module | Interface |
| --- | --- |
| `workspace.ts` | `~/.pi-profile-switch` workspace path (overridable via `PI_PROFILE_SWITCH_DIR`) |
| `json-file.ts` | Shared JSON reading for file-backed stores |
| `settings-generator.ts` | `generateRuntimeDir(plan, options)` (launcher, creates the directory) and `writeRuntimeFiles(runtimeDir, plan, options)` (in-session, rewrites in place) → generated files + symlink set + `{ PI_CODING_AGENT_DIR }` |
| `runtime-state-store.ts` | Reads and writes `pi-profile-state.json` (`activeProfile`, `overlay`) per source scope |

### In-session (inside the pi process)

| Module | Interface |
| --- | --- |
| `extensions/pi-profile/index.ts` | Registers the `/profile` command family, profile selector, CRUD wizards, and status views; loaded via `-e` |
| `switching/switch-profile.ts` | `switchProfile(profile, deps, options)` → `SwitchResult`; orchestrates snapshot → rewrite → reload → rollback |
| `switching/apply-plan.ts` | `readLaunchPlanFile(runtimeDir)` + `applyLaunchPlan(input)`; at `session_start` and after reload, applies the tools whitelist, persists runtime state, and emits the one-shot change summary |
| `switching/customize.ts` | `customizeOverlay` / `resetOverlay` / `parseCustomizeArgs`; reads and writes the runtime overlay |
| `switching/profile-crud.ts` | Semantic layer for create / edit / delete / duplicate |
| `switching/profile-wizard.ts` | Interactive wizards for create / edit / duplicate; UI injected via parameters |
| `switching/list-profiles.ts` | `/profile list`, with trust gating and the `shadowsGlobal` marker |
| `switching/status.ts` | `buildStatusReport` / `formatStatusMarkdown`; resolved paths, overlay, MCP tri-state, conflicts |
| `switching/tool-references.ts` | `expandToolReferences(refs, liveToolNames)`; expands tool references against Pi's live registry |

## Activation flow

### Launch

```text
pi-profile review -- --mode rpc
  │
  ├─ parseLauncherArgs: take review, intercept --approve, pass the rest through
  ├─ ProfileCatalog resolves the winning source of review
  ├─ project-trust reads the real trust.json → projectTrusted
  ├─ skill-registry + extension-discovery + mcp-config read-only discovery
  ├─ resolveProfile → ActivationPlan (glob expansion, overlay application, unmatched collection)
  ├─ Validation: declared model authenticated, extension entries exist, MCP adapter and servers exist
  ├─ generateRuntimeDir → this run's instance directory (generated files + seed + symlink mirror + env)
  └─ spawnPi: -e <extension> [trust flag] <user args verbatim>
       └─ the extension reads pi-profile.json at session_start, expands tools and setActiveTools
```

### In-session switching

```text
/profile use implement
  │
  ├─ Validate and resolve (same path as launch)
  ├─ ctx.waitForIdle()
  ├─ Snapshot managed runtime files (settings / plan / mcp / appendSystem / trust)
  ├─ Rewrite settings.json, pi-profile.json, mcp.json, APPEND_SYSTEM.md in place; trust.json link unchanged
  ├─ ctx.reload(): Pi re-reads disk, rebuilds resources, re-executes the extension
  │    ├─ the extension re-applies the tools whitelist
  │    └─ state.activeProfile is written by the new post-reload extension instance per source scope
  ├─ Success → the next agent turn receives a one-shot change summary
  └─ Failure → write back the snapshot and reload again; the runtime never shows a half-switched state
```

The sessionId and message history are identical before and after reload (verified in ADR-0005).

## Runtime directory

Each launch generates one instance directory at `<PI_PROFILE_SWITCH_DIR>/instances/launch-<random id>` (the workspace root defaults to `~/.pi-profile-switch`, overridable via `PI_PROFILE_SWITCH_DIR`), handed to pi via `PI_CODING_AGENT_DIR`. The path is bound to one launch and never reused: `PI_CODING_AGENT_DIR` cannot change inside the child process, so a fixed path could neither follow in-session switching nor survive concurrent launches rewriting each other's files (ADR-0010).

Managed files, mirroring, and sweep rules are contractual — see "Instance directory contract", "Stale instance sweep", and "Instance runtime-state seed" in `openspec/specs/launcher/spec.md`. What each managed file is for:

| File | Contents |
| --- | --- |
| `settings.json` | User global settings + arrays rewritten per the filtering model (user-level resources only; project settings are not merged) |
| `pi-profile.json` | This run's ActivationPlan, read by the in-pi extension at `session_start` |
| `mcp.json` | The filtered MCP server set |
| `APPEND_SYSTEM.md` | The profile's `instructions`, natively appended by Pi to the system prompt |
| `trust.json` | Symlink to the real trust store; Pi's project-level discovery follows it, and in-session switching never touches it. Form and creation conditions in `openspec/specs/launcher/spec.md`, "Instance directory contract" |
| `pid` | Child-process liveness marker; the next launch's sweep uses it to decide reclamation |
| `extensions` | Managed directory so that agentDir-level extensions enter only through the whitelist |

All other entries under the real agentDir stay in place and enter the instance through symlinks; entries that do not exist at generation time but are created at runtime are handled by the seed described below. This state is therefore never copied: `npm/`, `git/`, `bin/` are package install roots; `sessions/` keeps Pi's native per-directory structure and session files are always written in the real agentDir. User configuration files are never modified.

### Runtime-state seed

The mirror is a snapshot taken at generation time: only entries that already exist in the real agentDir get linked. Entries **created at runtime** must be seeded, otherwise they land inside the instance — where they would be swept away with it and where third-party records would embed instance paths.

Which paths are seeded, and in what form, is a behavior contract — see "Instance runtime-state seed" in `openspec/specs/launcher/spec.md`. Only two maintenance rules live here:

- The list only admits entries with **observed evidence** (a real run actually created the entry under agentDir); inference is not enough. Unlisted entries are routed by the sweep's content scan (see "Instance sweep"), never silently destroyed.
- Directories can be created directly (an empty directory's semantics are unambiguous); files must not be pre-created because their content belongs to Pi. Files use **dangling-tolerant** symlinks: Pi's `existsSync` sees them as "absent", and writes pass through the link to materialize as real files in the real agentDir, with the format always owned by Pi. The seed step runs after broken-link cleanup, otherwise the dangling links would be deleted by that very cleanup.

### Instance sweep

Sweeping happens at startup (before generating this run's instance), not at exit: every exit path terminates the pid, so the next launch's sweep always converges, and no deletion logic is needed on signal paths. The decision rules and warning requirements are contractual — see "Stale instance sweep" in `openspec/specs/launcher/spec.md`.

Unrecognized entries at the first level of a reclaimable directory are routed by content scan: content referencing the instance path, scan-limit overflow, or unconventional type → keep + warn (ADR-0010's protection is preserved as-is); location-agnostic content → adopted into the real agentDir, with the instance copy deleted on same-name conflict (real wins). Both branches print a notice to stderr. Entries inside `extensions/` only warn. The routing criteria and rejected alternatives are in ADR-0012.

### Example generated settings.json

For reading convenience, not a stable surface: this format evolves with Pi versions and drift is caught by integration tests. The authoritative definition is Pi's own settings schema.

```json
{
  "defaultProjectTrust": "never",
  "skills": [
    "/home/user/.pi/agent/skills/git-commit",
    "-/home/user/.agents/skills/secret-*"
  ],
  "extensions": [
    "/opt/pi-resources/review-guard/index.ts"
  ],
  "packages": [
    { "source": "npm:pi-skills", "skills": ["code-review"], "extensions": [] }
  ]
}
```

### User configuration contract

The authoritative schema for profile definition files (global `~/.pi-profile-switch/profiles/<name>.json`, project `.pi/profiles/<name>.json`) is `schemas/profiles.schema.json`. Core fields: a profile's `skills`/`extensions`/`mcps`/`tools` (names or globs), optional `defaultProvider`/`defaultModel`/`defaultThinkingLevel` and `instructions`; state's `activeProfile` and `overlay`.

## Known limitations

| Limitation | Consequence |
| --- | --- |
| Profiles do not govern project-level resources | A trusted project's skills, extensions, and MCP servers are available under every profile; even a read-only-style profile cannot hide them — project trust is the only gate. In an untrusted project, project-level resources are uniformly invisible |
| Behavior keys in project `.pi/settings.json` override profile declarations | Pi's merge order is project-over-global, so the project's `defaultProvider`/`defaultModel`/`defaultThinkingLevel` beat the profile's declarations; `defaultTools` only affects the boot baseline (the extension re-tightens tools at session start) |
| The extension `project_trust` event is not consulted | Consulting it would require executing extension code inside the launcher; third-party extensions depending on that event cannot influence the trust determination |
| `pi install` and `pi config` write into the generated settings mid-session | Lost on exit; persistent changes go through `/profile edit` or native `pi` |
| Legacy 0.4.x `instances/<profile>/agent` directories are untouched by the new sweep | Neither cleaned nor migrated; users dispose of them manually. The pi-subagents mission records inside carry absolute paths pointing at old instance paths and cannot be repaired (see ADR-0010) |
| Concurrent instances do not serialize writes to credential files | `auth.json` and `models-store.json` are shared through seed symlinks, but Pi's lock lands next to the symlink path, so two sessions do not serialize against each other and one concurrent refresh may be lost (see ADR-0010) |
| Skills provided by project packages are not referenceable | They are visible through Pi's native loading but do not appear in a profile's reference vocabulary; project `.pi/skills` and ancestor `.agents/skills` are referenceable |

## Package structure

| Group | Contents |
| --- | --- |
| `bin/` | CLI entry and postinstall. The published `pi-profile.js` is a jiti wrapper — Node refuses type-stripping for `.ts` under `node_modules`, while the launcher needs to load the shared TS graph; in development, `pi-profile.ts` runs directly. `postinstall.js` remains as a best-effort early optimization: it distributes the starter `ask` profile and the profile-config skill at install time, while runtime distribution is guaranteed by the launcher's ensure step (see `src/starter-assets.ts`); the authoritative behavior contract is [openspec/specs/profile-catalog/spec.md](../../openspec/specs/profile-catalog/spec.md) |
| `extensions/pi-profile/` | The extension inside the pi process: `/profile` command family, switch orchestration, status views |
| `src/starter-assets.ts` | Starter-asset ensure at launcher startup: a single TS implementation exporting `ensureStarterAssets()` (returns `path`/`written` per asset; IO failures degrade to `warnings`, never throw — design in [design.md D1/D5](../../openspec/changes/archive/2026-09-24-runtime-ensure-starter-assets/design.md)); the behavior contract is not restated here — see [openspec/specs/profile-catalog/spec.md](../../openspec/specs/profile-catalog/spec.md) |
| `src/launcher/` | Everything before spawn: argument parsing, initial-profile resolution, read-only discovery, model check, spawn, stale-directory sweep |
| `src/switching/` | In-session switching, overlay, CRUD, observability surface |
| `src/*.ts` | Modules shared by both sides: catalog, trust, discovery, resolver, settings generation, state stores |
| `schemas/` | `profiles.schema.json`, the authoritative definition of user configuration |
| `examples/` | `ask.json` (seeded starter) and `example.json` (full-field demo) |
| `test/` | Vitest: `*.test.ts` unit + `*.integration.test.ts` real subprocesses |

`package.json` declares both a Pi extension and the `pi-profile` binary: the extension provides in-conversation interaction; the binary handles initial resolution and spawn. `files` publishes `bin`, `extensions`, `src`, `schemas`, `examples`, and `README`.
