# pi-profile-switch

pi-profile-switch is a Pi package that adds named profiles to Pi. A profile references existing skills, extensions, MCP servers, and tools, and can be switched within the same Pi session. See `docs/prd.md` for product intent, design principles, and non-goals.

## Read first

Read per task; do not read everything up front.

| What you are doing | Read first |
| --- | --- |
| Changing behavior, commands, or configuration semantics | The "Non-goals" section of `docs/prd.md`, then the matching capability domain in `openspec/specs/` |
| Changing module boundaries, generated artifacts, or the activation flow | `docs/architecture/overview.md` |
| About to propose a more convenient design | `docs/adr/`; the design has likely already been rejected |
| Starting a new change | The `context` section of `openspec/config.yaml` |
| Editing `## Purpose` of a main spec | `docs/prd.md`; replace duplicated positioning with a link |

Terminology is defined by `CONTEXT.md`; the avoid-words flagged there must not be used.

## Operating constraints

### Pi compatibility first

- Before changing anything, confirm it does not affect behavior that no profile has declared control over. Pi's settings, resource discovery, and session behavior must remain intact.
- Do not introduce concepts Pi does not have. Extension dependency graphs, always-on extensions, and resource copies all fall in this category.
- Fields a profile does not declare must produce no side effects.

### Minimalism

- Before adding a user-visible configuration field, prove it cannot be replaced by discovery or a default value.
- Before adding a command, confirm there is no suitable place in the existing command family and that it does not occupy another Pi package's namespace.
- Errors must be actionable: offer candidates, near-miss names, or a fix; never fail silently.

### Documentation

- Fact-ownership criteria and capability domains live in the `context` section of `openspec/config.yaml`; do not repeat them elsewhere.
- Write each fact exactly once; link instead of restating when referencing facts owned elsewhere.
- Do not rewrite the decisions of existing ADRs. When a decision changes, add a new numbered file and mark the old one with a single top line: `**Superseded by ADR-XXXX.**`
- New ADRs use the next available number in `docs/adr/`; numbers are never reused.
- Reference ADRs by number, e.g. `ADR-0005`. Use repo-relative paths for file links.

### Code

- TypeScript ESM, imports carry the `.ts` extension, following the style of existing files.
- No new runtime dependencies unless existing ones cannot do the job.
- Integration tests spawn the launcher only via `runLauncher` from `test/helpers/launcher-runner.ts` — it closes child stdin, without which pi never exits (guarded by `test/launcher-runner.test.ts`).
- Run `npm run check` and `npm test` after changes.
- Commit messages use conventional commits; one commit does one thing.

## Change process

Changes that alter observable behavior, specification content, or decisions go through OpenSpec — never edit code or docs directly:

```text
/opsx-explore → /opsx-propose → /opsx-apply → /opsx-verify → /opsx-archive
```

Auxiliary flows are `/opsx-sync` and `/opsx-update`, defined in `.pi/prompts/opsx-*.md`. Artifact rules and archive gates live in the `rules` and `operations` sections of `openspec/config.yaml`.

Fixes that change none of the above are committed directly without opening a change: adding or removing documentation files, fixing links and typos, adjusting comments and test names, renaming files for pure restructuring. The criterion is whether it changes the reader's understanding of behavior: if it does, run the process.

### Process discipline and escalation

- **Archive on completion**: before starting a new change or entering apply, run `openspec list`; if a change has all tasks checked but is not yet archived, archive it first. Otherwise downstream changes pay dependency-chain lock overhead and validation noise when their deltas lack a base.
- **Deduplicate instruction calls**: for the same change and the same artifact, call `openspec instructions` only once in the main session; reuse the first output afterwards. Repeatedly pulling the full rule template inflates context.
- **Critical paths and team-workflow escalation**: the general escalation rules of team-workflow are in the `team-workflow` skill. In this project, apply must escalate to team-workflow for any change touching these per-session hot paths:
  - launcher startup flow and sequencing (`bin/pi-profile.ts`, `src/launcher/`)
  - instance runtime directory generation and sweeping (`src/settings-generator.ts`, `src/launcher/runtime-cleanup.ts`)
  - resource discovery and the filtering model (`src/profile-resolver.ts`, `src/skill-registry.ts`, `src/extension-discovery.ts`)
