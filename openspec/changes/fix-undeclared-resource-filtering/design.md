# Design

## Context

See [proposal.md](proposal.md) for motivation and scope.

`parseProfileDefinition` already preserves field absence. `resolveProfile` loses that distinction by defaulting both resource lists to empty arrays. `buildSelectionSettings` then rewrites both top-level resource arrays and both package filters unconditionally. The ordinary `default` path uses a separate native-settings branch; its overlay path currently invents wildcard declarations for both kinds.

Native settings-only extension paths are not all represented by `DiscoveredExtensions.list()`. Replacing omission with a wildcard would therefore still lose resources and native controls. Discovery ownership and the project boundary remain those of ADR-0008 and ADR-0011.

## Goals / Non-Goals

**Goals:** carry declaration intent across the resolver/generator boundary while retaining resolved arrays for overlays and existing status output. Keep native input as the base whenever a resource kind is undeclared.

**Non-Goals:** new discovery rules, native built-in reference identifiers, a new status format, catalog migration, or changes to MCP/tool policy. Resource behavior belongs in the delta specs; this document describes its encoding.

## Decisions

### D1. Separate declaration intent from resolved arrays

Add required per-kind declaration metadata to `ActivationPlan`. Keep `skills` and `extensions` as arrays, so an empty discovery result cannot be mistaken for an explicit deny policy and existing resolved-path consumers keep their shape.

For an omitted kind, the resolver uses the existing full referenceable discovery result as its overlay/status vocabulary. For a declared kind, it retains current reference expansion and validation. The metadata records whether the profile declared an allowlist, not whether an overlay later disabled an entry.

When an overlay narrows an omitted kind, also carry the concrete disabled entries. Its surviving discovery snapshot remains useful for status, but must not become the native kind's allowlist.

```text
profile field absent --> native base + optional resolved overlay exclusions
profile field present --> expanded allowlist - matching overlay entries
                           |
                           v
                per-kind settings materialization
```

**Alternatives rejected:** making both arrays optional would conflate reporting with control and force changes through array consumers. Defaulting to a wildcard would drop settings-only paths and freeze unresolved package contents into a discovery snapshot.

### D2. Materialize each kind against the real native input

The generator chooses its branch independently for skills and extensions:

- A declared kind uses the existing allowlist encoding, including an explicitly empty selection.
- An undeclared kind starts from current real user settings. Preserve native resource paths and override meaning; restore the real extension discovery directory additively because the instance's extension directory remains managed. Skills continue to use the existing mirror.
- An overlay on an undeclared kind adds only concrete force-exclusions. Keep settings-only resources outside its reference vocabulary intact.

Resource paths and exact exclusions must be mapped to their actual discovery paths after the agent directory moves. Preserve relative-path meaning and native inclusion/exclusion precedence. Native built-in identifiers stay literal rather than being resolved as filesystem paths. In a declared kind, retaining native exclusions must not re-add unrelated native additive includes; selected resources with a native force-inclusion exception must still load.

Package handling follows the same split. Rewrite an allowlist only for a declared kind. Preserve an undeclared kind's original filter, or its absence, and other package properties. Native-base overlays append package-relative force-exclusions only for matched entries. An existing empty native filter remains empty. Packages unresolved during read-only discovery retain their native undeclared-kind input; discovery must not install or contact the network to complete an allowlist.

Keep configured package source identity for matching against discovery; preserve its original resolution root when a native local source is relative. Changes to source/path encoding must preserve the package's unrelated resource meanings as well.

Carry native extension override controls through both branches. Their authoritative syntax and identifiers come from Pi, not a package-maintained inventory or an exemption list. The ordinary `default` path remains a regression baseline.

**Alternatives rejected:** changing the entire profile to `filter: "none"` when one field is absent would ignore the other field's explicit selection. Rewriting every package kind together is the existing bug. A native-base overlay encoded as a positive whitelist would hide settings-only resources and unresolved package contents.

### D3. Use sparse declarations for the default-overlay path

Replace the synthetic wildcard definition in `resolveInitialProfile` with an empty definition. The shared resolver supplies native referenceable bases and concrete exclusions for the kinds the overlay actually narrows. Preserve the existing rejection of MCP disables on `default` and existing tool-overlay behavior.

Switching keeps its current resolve, snapshot, rewrite, reload, and rollback boundary. Each rewrite uses real user settings; no previous-instance selection is treated as the next activation's native input.

**Alternative rejected:** retaining wildcard declarations for unrelated kinds makes a tool-only overlay accidentally change skill and extension visibility.

### Export surface

The additional internal fields in `src/profile-resolver.ts` are:

```ts
// Additions to ActivationPlan; existing fields remain.
resourceSelection: { skills: boolean; extensions: boolean };
disabledSkills?: SkillEntry[];
disabledExtensions?: ActivationPlan["extensions"];
```

`resourceSelection` is true for a kind exactly when its profile field is declared, including an empty array. `disabledSkills` and `disabledExtensions` contain resolved overlay exclusions only for an undeclared kind. Stored `RuntimeOverlay` entries remain strings and retain their existing lifecycle.

| File | Export / signature | Change and errors |
| --- | --- | --- |
| `src/profile-resolver.ts` | `defaultPlan(): ActivationPlan` | Populate both declaration flags as false; keep the ordinary default plan's existing resolved-array shape. |
| `src/profile-resolver.ts` | `resolveProfile(input: ResolveInput): Promise<ActivationPlan>` | Populate metadata, native referenceable snapshots, and native-base overlay exclusions. Existing `ActivationError` behavior remains. |
| `src/settings-generator.ts` | `generateRuntimeDir(plan: ActivationPlan, options: GenerateOptions): Promise<GeneratedRuntime>` | Consume per-kind control; signature and existing error propagation remain. |
| `src/settings-generator.ts` | `writeRuntimeFiles(runtimeDir: string, plan: ActivationPlan, options: RuntimeFileOptions): Promise<{ warnings: string[] }>` | Same consumption for in-place rewrites; prepare content before writes as today. |
| `src/launcher/initial-profile.ts` | `resolveInitialProfile(name: string \| undefined, context: LauncherContext, options?: { overlay?: RuntimeOverlay; liveToolNames?: string[] }): Promise<InitialProfile>` | Change only the synthetic default-overlay definition; existing activation errors remain. |

Declaration metadata and concrete exclusions are internal resolver-to-generator data. They need not be serialized into `pi-profile.json`; retain its existing resolved snapshots, tool fields, and switch markers. No durable format or new error class is introduced.

## Risks / Trade-offs

- Existing profiles can expose more resources after the fix --> publish explicit-empty upgrade guidance in both READMEs; do not silently rewrite catalogs.
- Native override precedence differs between ordinary resource lists and package filters --> compare actual loaded resources with native Pi, including broad exclusions, force-inclusion exceptions, empty package filters, and relative paths.
- Managed extension directories and symlinked skills have different lexical paths --> test exclusion matching against actual runtime discovery paths, including skills symlinked outside the real agent directory.
- Native-base overlays can unintentionally become global allowlists --> exercise settings-only extension paths, unresolved package declarations, and unrelated kinds under tool-only overlays.
- A required internal field affects hand-built test plans --> update `selectionPlan` in `test/settings-generator-selection.test.ts` and let TypeScript identify any other constructors; never infer declaration intent from array length.
- Project resources or sibling native settings can be affected by path/source changes --> retain the existing trust boundary and verify unmanaged settings and real source files are unchanged.

## Migration Plan

1. Implement and verify the artifact tasks before release.
2. Publish README guidance alongside the fix. Profiles that depended on accidental denial can explicitly declare empty arrays before upgrading.
3. Do not migrate catalogs, rewrite native settings, or change dependencies.
4. Activation failures continue to use the existing runtime rollback. Reverting the package version restores the former implementation without a persisted-format migration.
