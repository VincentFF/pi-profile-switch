# launcher Specification

## Purpose
Defines what the `pi-profile` launcher does before the Pi process exists: how it decides which arguments belong to the launcher and which to Pi, how the initial profile is chosen, what must fail before launch, and which project-scope content pi-profile reads.

## Requirements

### Requirement: CLI argument parsing and pass-through

The launcher's invocation form SHALL be `pi-profile [profile] [--] <pi args>...`.

The launcher SHALL consume exactly two inputs: one optional leading positional argument as the profile name (only when it does not start with `-`), and at most one `--` separator. Any `--` after that separator belongs to Pi.

All other arguments SHALL be passed verbatim to the spawned Pi process, whether or not Pi recognizes them. Positional arguments after the profile name belong to Pi.

`--approve`, `-a`, `--no-approve`, and `-na` SHALL be recognized as one-shot trust input and not passed through. When the same input recurs in contradictory forms, the last occurrence SHALL win.

#### Scenario: Positional argument and pass-through boundary

- **WHEN** launched as `pi-profile review -- --model openai/gpt-5.4 extra`
- **THEN** the profile name is `review` and Pi receives `--model openai/gpt-5.4 extra`

#### Scenario: Unknown Pi arguments pass through

- **WHEN** the user passes a flag Pi does not recognize
- **THEN** the launcher neither intercepts nor rejects it; the flag reaches Pi verbatim

#### Scenario: Trust flags are consumed, last one wins

- **WHEN** both `--approve` and `--no-approve` appear in the arguments
- **THEN** neither is passed to Pi, and the launcher takes the last one as the trust input

### Requirement: Initial profile selection

When a positional argument is given, the launcher SHALL use that name.

When no positional argument is given, the launcher SHALL try in order: the saved selection of a trusted project, the saved global selection, the built-in `default`.

When the name given by positional argument does not exist, the launcher SHALL fail before starting Pi. When a name restored from saved state no longer exists, the launcher SHALL fall back to `default` with a warning and MUST NOT block startup.

An initial selection given via CLI SHALL NOT be written to runtime state.

#### Scenario: Positional argument names an unknown profile

- **WHEN** launched as `pi-profile nosuchprofile`
- **THEN** startup fails, the error names the profile, and no Pi process is created

#### Scenario: Saved selection has gone stale

- **WHEN** no positional argument is given and the saved active profile no longer exists in the catalog
- **THEN** startup continues with `default`, printing a warning that explains the fallback

#### Scenario: Trusted project's saved selection wins

- **WHEN** no positional argument is given, the project is trusted with an active profile in project state, and global state holds a different one
- **THEN** the active profile from project state is used

### Requirement: Pre-launch failure and exit codes

The following failures SHALL abort startup before the Pi process is created: unknown profile, unresolvable references, MCP servers declared while the adapter is unavailable, illegal catalog content, illegal MCP configuration content, declared model failing validation.

The failures above SHALL exit with code `2`. Other unexpected failures SHALL exit with code `1`. Failure messages SHALL be written to stderr.

#### Scenario: Declared model not authenticated

- **WHEN** the model declared by the profile does not exist or is not authenticated
- **THEN** startup exits with code `2` and no Pi process is created

#### Scenario: Catalog content corrupt

- **WHEN** a catalog file's content is illegal
- **THEN** startup exits with code `2` and the error identifies the file path

### Requirement: Project trust gating

Project-scope content that pi-profile reads itself — the project catalog, project runtime state, project MCP configuration — SHALL be read only when the project is trusted.

The visibility of project-level resources (`.pi/skills`, `.pi/extensions`, ancestor `.agents/skills`, `.pi/prompts`, `.pi/themes`, `.pi/settings.json`) SHALL be decided by Pi's own project-trust determination. pi-profile MUST NOT narrow, attach, or exclude these resources through generated settings.

The trust determination SHALL take the first applicable result in this order: one-shot `--approve` or `--no-approve` input; a project containing no trust-requiring resources counts as trusted; the nearest ancestor's stored decision in the real `trust.json`; the user's global `defaultProjectTrust` set to `always`; otherwise untrusted.

Trust-requiring project resources SHALL include pi-profile's own project files `<projectDir>/.pi/profiles/` and `<projectDir>/.pi/pi-profile-state.json`.

The trust determination MUST NOT execute any extension code.

The trust flag recorded by the launcher SHALL be re-attached to the spawned Pi process and SHALL behave identically for every profile: one-shot trust input SHALL determine both the project catalog's readability and Pi's project-level visibility under any profile; the two MUST NOT diverge.

#### Scenario: One-shot trust input beats stored decision

- **WHEN** `trust.json` records the current project as untrusted, and this launch carries `--approve`
- **THEN** project resources are readable in this launch

#### Scenario: Named profiles forward the trust flag too

- **WHEN** launched as `pi-profile doc -- --no-approve`
- **THEN** the Pi process receives `--no-approve`, and the flag does not appear among the user arguments

#### Scenario: Project defaultProjectTrust is ask

- **WHEN** the user's global setting is `ask` and `trust.json` has no record for the current project
- **THEN** neither the project catalog nor project runtime state is read, and a named profile's project-level resources are not visible

#### Scenario: Only pi-profile's project files exist

- **WHEN** the project directory contains only a `.pi/profiles/` directory and no project resources Pi recognizes
- **THEN** the project is still judged to contain trust-requiring resources and is not auto-trusted for "having no project resources"

### Requirement: Launch diagnostic output

The launcher SHALL print non-fatal diagnostics to stderr and continue startup: extension discovery warnings, and glob references with zero matches during resolution.

#### Scenario: Zero-match glob

- **WHEN** a glob reference in the profile matches nothing in this resolution
- **THEN** startup continues, and stderr carries a warning identifying the zero-match reference

### Requirement: Instance directory contract

The launcher SHALL generate one instance directory per launch at `<PI_PROFILE_SWITCH_DIR>/instances/launch-<random id>`, with the workspace root defaulting to `~/.pi-profile-switch`. Each launch SHALL use a previously nonexistent path; multiple launches of the same profile MUST NOT reuse the same path.

The directory SHALL be handed to the Pi process via `PI_CODING_AGENT_DIR`. The launcher SHALL remove `PI_CODING_AGENT_SESSION_DIR` from the child process environment so that session storage is decided by the instance; the instance's `sessions` is a mirror of the real agentDir's corresponding directory.

The managed files in the instance (`settings.json`, `pi-profile.json`, `mcp.json`, `APPEND_SYSTEM.md`, `trust.json`, `pid`, `extensions`) are generated by pi-profile; `pid` SHALL record the Pi child process ID of this launch. All other files and directories under the real agentDir SHALL be mirrored into the instance as symlinks, with broken links cleaned up at link time.

`trust.json` SHALL be a symlink to the corresponding path in the real agentDir, and this SHALL hold for every profile: it MUST NOT be omitted or removed because the profile is not `default`, and MUST NOT be skipped because the target file does not exist yet (trust decisions Pi writes through the link land in the real agentDir).

When a profile declares `mcps`, the instance's `mcp.json` SHALL be the generated filter result containing only the allowed server definitions. For unselected servers in user-level shared locations (`~/.config/mcp/mcp.json`, `~/.agents/mcp.json`, `~/.agents/mcp/mcp.json`), the instance configuration SHALL explicitly mark them disabled and MUST NOT rely on omission alone: these locations are read directly by the adapter, and without a disable mark an omitted server does not become ineffective. Servers defined in project-level locations (project `.mcp.json`, project `.pi/mcp.json`) SHALL stay enabled and MUST NOT be marked disabled.

User configuration files MUST NOT be modified.

#### Scenario: Instance path fixed per profile

- **WHEN** the same profile is launched twice in a row
- **THEN** the two launches use different instance paths (scenario name kept from the old contract's wording; the assertion has been inverted)

#### Scenario: Unrestricted MCP configuration is linked directly

- **WHEN** the profile does not declare `mcps` and `mcp.json` exists under the real agentDir
- **THEN** the instance's `mcp.json` is a symlink to that file and its content is not rewritten

#### Scenario: Named profiles do link trust.json

- **WHEN** launched with a named profile
- **THEN** a `trust.json` link exists in the instance and points at the corresponding path in the real agentDir (scenario name kept from the old contract's wording; the assertion has been inverted)

#### Scenario: Restricted MCP configuration disables unselected shared servers

- **WHEN** the profile declares `mcps` allowing only server A, while the user-level shared configuration also defines server B
- **THEN** the instance's `mcp.json` contains A's definition and contains B with a disable mark; B is not connected

#### Scenario: Project-sourced MCP servers are not disabled

- **WHEN** the profile declares `mcps` allowing only server A, while project `.mcp.json` defines server P
- **THEN** P carries no disable mark in the instance's `mcp.json` and remains usable

### Requirement: Stale instance sweep

The launcher SHALL sweep stale directories under the instance root `<PI_PROFILE_SWITCH_DIR>/instances` before generating this run's instance, and SHALL only reclaim instance directories of the shape it generates; other directories under the root MUST NOT be deleted.

Whether to reclaim an instance directory SHALL be decided in this order: keep when `pid` is parseable and the process is alive (including present but unsignalable); reclaim when `pid` is parseable and the process is gone; when `pid` is missing or unparseable, reclaim only if the directory mtime is beyond the grace period.

For an instance directory judged reclaimable, the launcher SHALL examine each first-level entry not generated by pi-profile (neither a symlink nor a managed generated artifact) and route it by content:

- If the entry is a regular file or directory whose content does not reference its own instance's path (directories are checked recursively over all their content; exceeding the scan limit counts as undecidable) and the real agentDir has no same-named entry, the launcher SHALL move it into the real agentDir (adoption) and print a one-line notice to stderr naming the entry and its destination.
- If the entry meets the conditions above but the real agentDir already has a same-named entry, the launcher SHALL delete the instance copy (the real agentDir wins) and print a one-line notice to stderr naming the entry. This branch SHALL NOT compare the two sides' content.
- If the entry's content references its own instance's path, the scan limit was exceeded so it cannot be decided, or the entry is not a regular file or directory, the launcher SHALL keep the entry and print a warning to stderr; the warning SHALL identify the directory, the unrecognized entries, and the available dispositions.

Unrecognized entries inside the managed `extensions/` directory SHALL only be handled with the warning above and MUST NOT be adopted or deleted.

When any kept unrecognized entries exist, the instance directory SHALL be kept as a whole; once all unrecognized entries have been adopted or deleted, the directory SHALL be reclaimed.

Sweeping SHALL be best-effort: an error in a single directory MUST NOT interrupt the sweep or block startup. Instance directories SHALL NOT be deleted at exit; reclamation happens only in later launches' sweeps.

#### Scenario: Kept while pid is alive

- **WHEN** an instance directory's `pid` points at a still-running process
- **THEN** the directory is not reclaimed

#### Scenario: Reclaimed after pid exits

- **WHEN** the process an instance directory's `pid` points at no longer exists
- **THEN** the directory is reclaimed

#### Scenario: Directory without pid kept within grace period

- **WHEN** an instance directory has no `pid` file and its mtime is within the grace period
- **THEN** the directory is not reclaimed

#### Scenario: Kept with warning when unrecognized entries exist

- **WHEN** a reclaimable instance directory contains unrecognized entries whose content references the instance's path, that exceed the scan limit, or that are not regular files or directories
- **THEN** the directory is kept, and stderr carries a warning identifying the directory and the entries (scenario name kept from the old contract's wording; the condition has been narrowed to the non-adoptable subset)

#### Scenario: Unrecognized entry adopted into the real agentDir

- **WHEN** a reclaimable instance directory contains an unrecognized entry whose content does not reference the instance's path, and no same-named entry exists under the real agentDir
- **THEN** the entry is moved into the real agentDir with a one-line notice on stderr; when no other kept entries remain in the directory, the directory is reclaimed

#### Scenario: Instance copy deleted when the real agentDir already has the entry

- **WHEN** a reclaimable instance directory contains an unrecognized entry whose content does not reference the instance's path, but the real agentDir already has a same-named entry
- **THEN** the instance copy is deleted without content comparison, with a one-line notice on stderr; when no other kept entries remain in the directory, the directory is reclaimed

#### Scenario: Unrecognized entries inside managed directories only warn

- **WHEN** a reclaimable instance directory's managed `extensions/` directory contains an unrecognized entry
- **THEN** the entry is neither adopted nor deleted, the directory is kept, and stderr carries a warning identifying the entry

#### Scenario: Directories not of this run's shape are not deleted

- **WHEN** a directory not matching the current generation shape exists under the instance root
- **THEN** the directory is not deleted and does not affect this launch

### Requirement: Instance runtime-state seed

Before mirroring the real agentDir into the instance, the launcher SHALL point the state paths Pi creates at runtime at the real agentDir, so these writes do not land inside the instance:

| Path | Form | Seed method |
| --- | --- | --- |
| `sessions`, `missions` | Directory | Created under the real agentDir when missing, left as-is when present; the launcher MUST NOT write their content |
| `auth.json`, `models-store.json` | File | A symlink is created inside the instance pointing at the corresponding real-agentDir path; the link SHALL be created even when the target file does not exist |

For file-class paths, the launcher SHALL NOT delete the link inside the instance because the real agentDir lacks the corresponding file, and MUST NOT create or write that file itself; the file's content and format are Pi's to decide.

Paths not covered by the seed are still handled per "Stale instance sweep".

#### Scenario: Symlink established on first launch

- **WHEN** any profile is launched while no `missions` directory exists under the real agentDir
- **THEN** a `missions` directory appears under the real agentDir, and `missions` inside the instance is a symlink to it

#### Scenario: Not rewritten when present

- **WHEN** a `missions` directory with records already exists under the real agentDir
- **THEN** that directory's content is unchanged, and `missions` inside the instance is a symlink to it

#### Scenario: Symlink established even when the target file does not exist

- **WHEN** any profile is launched while no `auth.json` exists under the real agentDir
- **THEN** `auth.json` inside the instance is a symlink to the corresponding real-agentDir path, and no `auth.json` is created under the real agentDir

#### Scenario: Writes through the symlink land in the real agentDir

- **WHEN** a process writes `auth.json` inside the instance
- **THEN** the real agentDir's `auth.json` receives the content, and the entry inside the instance remains a symlink

#### Scenario: Symlinks survive an in-place rewrite of the same instance directory

- **WHEN** the same instance directory is rewritten in place (in-session switching)
- **THEN** `auth.json` and `models-store.json` are still symlinks

### Requirement: Subprocess launch

The launcher SHALL start the real Pi binary and load the pi-profile extension shipped with the package via `-e`. User arguments SHALL be appended verbatim after the extension argument.

The launcher SHALL forward the child process's exit code and forward signals to the child process.

#### Scenario: Argument order

- **WHEN** the launcher builds Pi's argv
- **THEN** the order is: extension argument, recorded one-shot trust flag (when present), user arguments

#### Scenario: Exit code forwarding

- **WHEN** the Pi child process exits with code N
- **THEN** the launcher exits with code N
