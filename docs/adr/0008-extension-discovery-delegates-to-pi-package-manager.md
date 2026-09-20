# Extension discovery delegates entry enumeration to Pi's package manager

Refines [ADR-0006](0006-discovery-first-extension-references.md) and [ADR-0007](0007-discovery-only-extension-filtering.md): discovery stays, its entry enumeration does not.

## Context

ADR-0007 established "discover & filter": `ExtensionDiscovery` reads configured packages and loose extension files, and profiles reference the result. Discovery is unavoidable — a profile stores symbolic references ("pi-web-access"), the generated settings need concrete entry paths, and Pi has no runtime extension-toggle API.

What ADR-0007 did not settle is *who owns the discovery rules*. `extension-discovery.ts` re-implemented them by hand: read `package.json#pi.extensions`, `stat` each declared entry, scan the extensions dirs for `*.{ts,js}`, derive stems. Pi resolves the same facts in `package-manager.js` (`collectAutoExtensionEntries` → `resolveExtensionEntries` → `collectFilesFromPaths`, plus its own `+`/`-`/`!` filter and ignore-file handling).

The two implementations drifted, silently and repeatedly:

- **Directory entries** (`"extensions": ["./dist"]`, the convention for every compiled extension package) were dropped: the hand-rolled check required a regular file, so `pi-web-access` resolved to nothing and activation failed with `unknown extension: "pi-web-access"` even though Pi itself loaded the package. This is the bug that surfaced the problem.
- `.gitignore`, dot-file, and `node_modules` exclusions, and the package-level include/exclude filters, were absent — so the selectable name list contained entries the spawned pi would never load.
- Each future Pi convention (a new entry shape, a new ignore rule, a new precedence rule) would need a matching change here, with no test able to notice the gap: the tests only asserted the hand-rolled rules against themselves.

The cost of the duplication was 120+ lines of mirror logic that could only ever be verified as *internally* consistent — never as consistent with Pi.

## Decision

Keep discovery, delete the re-implemented rules. `ExtensionDiscovery` now calls Pi's own resolver and classifies its output:

1. **Entry enumeration is Pi's.** `discoverImplicitExtensions` builds a `DefaultPackageManager` (`SettingsManager.create(cwd, agentDir, { projectTrusted })`) and calls `resolve(async () => "skip")`. Package entries, loose files, precedence, and filters all come from Pi's implementation.
2. **`"skip"` preserves the read-only contract.** `onMissing: "skip"` reports missing sources as absent instead of installing them: no install, no network, no filesystem mutation. Extension modules are still never imported (`resolve()` only reads files; `DefaultResourceLoader.getExtensions()`, which *does* execute code, remains off-limits and is not used).
3. **pi-profile-switch keeps only its own concepts**: selectable IDs (package name / `name:relative-path` / loose stem), project-over-global merging, `select()` resolution (name, source alias, entry ID, glob, absolute path), and error messages. Package-origin entries are grouped per configured source; entries are always concrete files, because that is what Pi's resolver produces.
4. **Path references name files.** A profile path reference (absolute or `~/`) must point at an extension file. Directory expansion is deliberately not added: the loader imports referenced paths verbatim, and the generated package allowlist matches file paths, so accepting a directory would only move the failure.

## Consequences

- Pi is the single source of truth for what is loadable, so the selectable list cannot disagree with what the spawned pi loads. Fixes to Pi's discovery (or new conventions) reach pi-profile-switch for free; the `./dist` class of bug cannot recur.
- Additive: compiled packages (`./dist`), packages declaring subdirectory `index.ts` entries, and `<agentDir>/extensions/<dir>/index.ts` extensions become selectable for the first time.
- Narrowing: entries excluded by `.gitignore`, dot-file or `node_modules` rules, or by a package's own `+`/`-`/`!` filter, are no longer advertised — they were never loadable, so the change removes names that could only fail at spawn.
- Object-form settings package entries (`{ source, extensions: [...] }`) now honor their filters, matching Pi's behavior.
- A package whose entries are all filtered out stays listed with zero entries, so selecting it reports "declares no extension entries" instead of "unknown extension".
- Project-scope packages and untrusted projects are still excluded, from the same inputs as before (`cwd`, `agentDir`, `projectTrusted`); `resolve()` gates project directories on `isProjectTrusted()` exactly like Pi.
- `resolve()` also resolves skills, prompts, and themes. That work is redundant with `SkillRegistry` (which reads the same sources through its own Pi-SDK path), but it is read-only, runs in parallel with skill discovery, and needs no subprocess or network — accepted rather than re-implementing a narrower resolver Pi does not expose.
- Failure mode if the SDK changes: `resolve()` is public API (`PackageManager`), whereas the rules it replaces were not; the coupling is now to a supported contract instead of to unexported internals.
