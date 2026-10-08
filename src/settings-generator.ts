/**
 * SettingsGenerator: materializes an ActivationPlan as a pi-profile-owned
 * runtime directory (ADR-0005).
 *
 * Two entry points:
 * - `generateRuntimeDir` (launcher): create a fresh per-launch runtime dir
 *   under the workspace instances root, write the files, mirror the real
 *   agent dir as symlinks (trust.json only for default), derive env.
 * - `writeRuntimeFiles` (in-session switch, ticket 05): rewrite
 *   settings.json + pi-profile.json inside the EXISTING runtime dir (the
 *   running process's PI_CODING_AGENT_DIR cannot move), and transition the
 *   trust.json link to match the new plan's filter mode.
 *
 * For the built-in `default` profile the generated settings preserve the
 * user's global settings untouched and re-include the real agent dir's
 * resource dirs (their discovery root moves with `PI_CODING_AGENT_DIR`), so
 * the spawned pi behaves exactly like native `pi`.
 *
 * For named profiles the generated settings encode the profile's selection
 * over user-scope resources only (see docs/architecture/overview.md):
 * - agentDir-scope resources: additive allowlist paths (the discovery root
 *   moved, so nothing auto-discovered from the real agent dir)
 * - `~/.agents` skills: always auto-discovered, so unselected ones are
 *   force-excluded with `-<path>` entries
 * - packages: user-configured package entries rewritten to object form with
 *   per-type allowlists (unmanaged types keep the user's key or Pi's default)
 * - project-scope resources (project `.pi/skills`, project `.pi/extensions`,
 *   ancestor `.agents/skills`) are never encoded: Pi discovers them natively
 *   whenever the project is trusted, and the profile neither adds nor
 *   excludes them
 * - `defaultProjectTrust: "never"` only suppresses Pi's interactive trust
 *   prompt (a stored decision in the real trust.json still applies); the
 *   project's `.pi/settings.json` is not merged here — Pi reads it natively
 * - unmanaged kinds (prompts, themes) pass through: the user's arrays are
 *   preserved and the real agent dir's prompts/themes dirs re-included
 * - tools/model are written to generated settings (defaultTools,
 *   defaultProvider, defaultModel, defaultThinkingLevel); the launch plan
 *   file feeds the in-pi extension (tools strict allowlist, status)
 *
 * User configuration files are never modified.
 */

import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, lstat, readdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { ActivationError, buildInstanceMcpConfig, type ActivationPlan } from "./profile-resolver.ts";
import { applySubagentSettings, SubagentSettingsError } from "./subagent-settings.ts";
import { getInstancesRootDir } from "./workspace.ts";
import { isRecord } from "./json-file.ts";
import { loadMergedMcpServers, type MergedMcpResult } from "./mcp-config.ts";
import type { SkillEntry } from "./skill-registry.ts";

/** A configured global package and its resolved install/local root. */
export interface ConfiguredPackageRoot {
	/** The source string exactly as written in the user's settings. */
	source: string;
	/** Absolute install/local root; undefined when not resolvable offline. */
	root?: string;
}

/** Full discovery results the generator needs beyond the plan itself:
 *  the complete skill set (for `~/.agents` exclusions) and configured
 *  package roots (for classifying extension entries). */
export interface DiscoveryContext {
	skills: SkillEntry[];
	packages: ConfiguredPackageRoot[];
}

export interface GenerateOptions {
	/** The user's real agent dir (e.g. ~/.pi/agent). */
	agentDir: string;
	/** Optional home dir override (useful for testing). */
	homeDir?: string;
	/** Optional trusted project dir. */
	projectDir?: string;
	/** Required for selection plans; unused for the default profile. */
	discovery?: DiscoveryContext;
}

export interface GeneratedRuntime {
	/** The generated runtime directory (becomes PI_CODING_AGENT_DIR). */
	runtimeDir: string;
	/** Environment variables for the spawned pi process. */
	env: Record<string, string>;
	/** Non-fatal diagnostics (e.g. malformed MCP sources skipped under an
	 *  undeclared MCP policy). The launcher prints them on stderr. */
	warnings: string[];
}

/** Files managed explicitly by pi-profile in runtimeDir; excluded from auto-symlinking. */
export const MANAGED_INSTANCE_FILES = new Set([
	"settings.json",
	"mcp.json",
	"APPEND_SYSTEM.md",
	"pi-profile.json",
	"trust.json",
	"pid",
	"extensions",
]);

/** State directories that Pi and its extensions resolve under the agent dir,
 *  and which therefore appear at runtime rather than at install time. They are
 *  seeded in the REAL agent dir before mirroring, so the instance gets a
 *  symlink instead of a private real directory: runtime-created state then
 *  lands where native Pi puts it, and third-party records never embed an
 *  instance path (ADR-0010). Adding a name here needs observed evidence that a
 *  package creates that directory under the agent dir; anything unlisted shows
 *  up as an unrecognized entry in the sweep (src/launcher/runtime-cleanup.ts). */
const SEEDED_STATE_DIRS = ["sessions", "missions"] as const;

/** State FILES Pi creates at runtime (same evidence rule as the dirs). They
 *  cannot be created up front — the content is Pi's, not pi-profile's — so the
 *  instance gets a symlink into the real agent dir that is deliberately allowed
 *  to dangle: Pi sees no file, writes through the link, and the real agent dir
 *  gets the file. A real file left here instead would be unrecognized state and
 *  would strand credentials in a directory the sweep refuses to delete. */
const SEEDED_STATE_FILES = ["auth.json", "models-store.json"] as const;

/** Resource dirs rooted at the real agent dir, re-included for the default
 *  profile because PI_CODING_AGENT_DIR moves the discovery root. */
const RESOURCE_DIR_KINDS = ["skills", "extensions", "prompts", "themes"] as const;

/** Unmanaged resource dirs re-included for every profile (pi-profile does
 *  not manage prompt templates or themes). */
const UNMANAGED_DIR_KINDS = ["prompts", "themes"] as const;

async function exists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}

/** Symlink-aware existence check (lstat): a dangling symlink still counts as
 *  existing — a stat-based check misses it, which would skip its removal or
 *  collide on symlink creation. Use this for paths pi-profile links itself. */
async function existsLexical(filePath: string): Promise<boolean> {
	try {
		await lstat(filePath);
		return true;
	} catch {
		return false;
	}
}

function toPosix(filePath: string): string {
	return filePath.split(path.sep).join("/");
}

function tryRealpath(p: string): string {
	try {
		return realpathSync(p);
	} catch {
		return path.resolve(p);
	}
}

function isUnderPath(target: string, root: string): boolean {
	const relative = path.relative(root, target);
	if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
		return true;
	}
	const normRelative = path.relative(tryRealpath(root), tryRealpath(target));
	return normRelative !== "" && !normRelative.startsWith("..") && !path.isAbsolute(normRelative);
}

/** The HOME-level ~/.agents/skills dir: always auto-discovered by Pi,
 *  unsuppressible via PI_CODING_AGENT_DIR, so it needs exclusion entries. */
function homeAgentsSkillsDir(): string {
	return path.join(process.env.HOME ?? homedir(), ".agents", "skills");
}

/** The user's own skill exclusions and force-inclusions (`!pattern`, `+path`,
 *  `-path`), carried into a named profile's generated settings. Relative
 *  entries resolve against the runtime dir, which mirrors the agent dir, so
 *  they pass through unchanged. An absolute (or `~`) `+`/`-` path under the
 *  agent dir is rewritten to its runtime mirror path: Pi matches `+`/`-`
 *  entries lexically. Plain additive includes are NOT carried: a declared
 *  selection must not re-add unrelated native paths. */
function userSkillExclusions(userSkills: unknown, agentDir: string, runtimeDir: string): string[] {
	if (!Array.isArray(userSkills)) return [];
	const exclusions: string[] = [];
	for (const entry of userSkills) {
		if (typeof entry !== "string") continue;
		if (entry.startsWith("!")) {
			exclusions.push(entry);
		} else if (entry.startsWith("+") || entry.startsWith("-")) {
			const marker = entry[0];
			const target = entry.slice(1);
			const expanded = target === "~" || target.startsWith("~/") ? path.join(process.env.HOME ?? homedir(), target.slice(1)) : target;
			const rel = path.isAbsolute(expanded) ? path.relative(agentDir, expanded) : undefined;
			const underAgentDir = rel !== undefined && rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
			exclusions.push(underAgentDir ? `${marker}${path.join(runtimeDir, rel)}` : entry);
		}
	}
	return exclusions;
}

/** The `-<path>` force-exclusion for one resolved skill entry, matching the
 *  path Pi discovers at runtime: agentDir skills surface through the
 *  instance's runtime-mirror symlink, everything else keeps its absolute
 *  path. Package skills are encoded in their package's filter instead. */
function skillExclusionEntry(skill: SkillEntry, agentDir: string, runtimeDir: string): string {
	if (isUnderPath(skill.filePath, agentDir)) {
		return `-${path.join(runtimeDir, path.relative(agentDir, skill.filePath))}`;
	}
	return `-${skill.filePath}`;
}

/** The user's native built-in extension controls (`!builtin:*`,
 *  `+builtin:<name>`, `-builtin:<name>`), as written. Their identities and
 *  syntax are Pi's, so they are carried verbatim rather than reconstructed. */
function nativeBuiltinControls(userExtensions: unknown): string[] {
	if (!Array.isArray(userExtensions)) return [];
	return userExtensions.filter(
		(entry): entry is string => typeof entry === "string" && /^[!+-]builtin:/.test(entry),
	);
}

/** Appends overlay force-exclusions to a package kind's native filter. An
 *  absent native filter becomes just the exclusions; an existing explicitly
 *  empty filter stays empty (nothing was loadable to exclude). */
function appendPackageExclusions(native: unknown, excludes: string[] | undefined): unknown[] | undefined {
	if (excludes === undefined || excludes.length === 0) {
		return Array.isArray(native) ? native : undefined;
	}
	const forceExcludes = excludes.map((rel) => `-${rel}`);
	if (native === undefined) return forceExcludes;
	if (!Array.isArray(native)) return undefined;
	if (native.length === 0) return native;
	return [...native, ...forceExcludes];
}

/** Pi's built-in MCP discovery entry points (see installed Pi
 *  `dist/extensions/mcp/index.js`, `codemode/tool.js`, `tool-search/tool.js`).
 *  These are the tools a narrowed `tools` profile must keep reachable when an
 *  MCP server is enabled; their identities are Pi's, not a profile field. */
const MCP_GATEWAY_TOOL_NAMES = ["codemode", "tool_search"] as const;

/** Whether the prepared effective MCP set contains at least one enabled
 *  server (user-level snapshot entries with `enabled !== false`, plus any
 *  enabled trusted-project server Pi reads itself). */
function hasEnabledMcpServer(
	instanceMcpConfig: Record<string, unknown>,
	discovery: MergedMcpResult,
): boolean {
	const snapshotServers = instanceMcpConfig.mcpServers;
	if (isRecord(snapshotServers)) {
		for (const def of Object.values(snapshotServers)) {
			if (isRecord(def) && def.enabled !== false) return true;
		}
	}
	for (const name of discovery.projectServers) {
		const def = discovery.servers[name];
		if (def !== undefined && def.enabled !== false) return true;
	}
	return false;
}

function buildSelectionSettings(
	plan: ActivationPlan,
	userSettings: Record<string, unknown>,
	agentDir: string,
	discovery: DiscoveryContext,
	runtimeDir: string,
	projectDir?: string,
): Record<string, unknown> {
	const settings = { ...userSettings };
	const skillsDeclared = plan.resourceSelection.skills;
	const extensionsDeclared = plan.resourceSelection.extensions;

	const packageRoots = discovery.packages
		.filter((pkg): pkg is ConfiguredPackageRoot & { root: string } => pkg.root !== undefined)
		.map((pkg) => ({ ...pkg, root: pkg.root }));
	const projectExtensionsDir =
		projectDir !== undefined ? path.join(projectDir, ".pi", "extensions") : undefined;

	// --- skills ---
	// A declared kind is an allowlist over the user-level reference set. An
	// undeclared kind preserves native settings and the agentDir mirror, adding
	// only the overlay's concrete force-exclusions (no explicit agentDir/skills
	// re-include, which would defeat the user's own `!`/`-` exclusions).
	if (skillsDeclared) {
		const selectedPaths = new Set(plan.skills.map((skill) => skill.filePath));
		const skillEntries: string[] = [];
		for (const skill of plan.skills) {
			if (skill.origin === "package") continue; // encoded in the packages allowlist
			// Project scope belongs to Pi: a trusted project's skills are discovered
			// natively, so selecting one here would duplicate it and excluding one
			// would contradict the profile's boundary.
			if (skill.scope === "project") continue;
			if (isUnderPath(skill.filePath, homeAgentsSkillsDir())) continue; // auto-discovered anyway
			skillEntries.push(skill.filePath);
		}
		for (const skill of discovery.skills) {
			if (skill.origin === "package") continue;
			if (skill.scope === "project") continue;
			if (selectedPaths.has(skill.filePath)) continue;
			// Lexical paths only: Pi matches `-` exclusions against the raw
			// discovered path without resolving symlinks. Resolving realpaths here
			// escapes runtimeDir whenever an agentDir skill is a symlink to outside
			// the agent dir, and the exclusion then silently matches nothing.
			skillEntries.push(skillExclusionEntry(skill, agentDir, runtimeDir));
		}
		// Discovery already honored the user's own `!pattern` / `+path` / `-path`
		// skill entries, so the skills they hide never reach the loop above and
		// get no `-` entry. Replacing the user's array would then drop those
		// exclusions and let the instance's skills symlink and ~/.agents/skills
		// reveal them; dropping a `+` force-inclusion would hide a selected skill
		// the user explicitly kept.
		skillEntries.push(...userSkillExclusions(userSettings.skills, agentDir, runtimeDir));
		settings.skills = skillEntries;
	} else {
		const exclusions = (plan.disabledSkills ?? [])
			.filter((skill) => skill.origin !== "package")
			.map((skill) => skillExclusionEntry(skill, agentDir, runtimeDir));
		if (exclusions.length > 0) {
			const native = Array.isArray(settings.skills) ? settings.skills : [];
			settings.skills = [...native, ...exclusions];
		}
	}

	// --- extensions ---
	// Entries under a package root are encoded in that package's allowlist;
	// everything else becomes an additive absolute path.
	const packageExtensions = new Map<string, string[]>();
	const extensionEntries: string[] = [];
	if (extensionsDeclared) {
		for (const extension of plan.extensions) {
			// Loose project extensions are discovered natively by Pi; an explicit
			// path reference inside the project (outside `.pi/extensions`) is the
			// profile's own selection and stays.
			if (projectExtensionsDir !== undefined && isUnderPath(extension.entry, projectExtensionsDir)) continue;
			const owner = packageRoots.find((pkg) => isUnderPath(extension.entry, pkg.root));
			if (owner === undefined) {
				extensionEntries.push(extension.entry);
			} else {
				const list = packageExtensions.get(owner.source) ?? [];
				list.push(toPosix(path.relative(owner.root, extension.entry)));
				packageExtensions.set(owner.source, list);
			}
		}
		// Pi's built-in extension enable/disable controls are native settings,
		// not profile references: retain them so a declared extension selection
		// does not silently re-enable a built-in the user disabled.
		extensionEntries.push(...nativeBuiltinControls(userSettings.extensions));
		settings.extensions = extensionEntries;
	} else {
		const native = Array.isArray(settings.extensions) ? settings.extensions : [];
		// The instance's extensions directory is profile-managed (not mirrored),
		// so the real discovery directory is restored additively to keep loose
		// agentDir extensions visible under an omitted extension field.
		const realExtensionsDir = path.join(agentDir, "extensions");
		const addDir = existsSync(realExtensionsDir) ? [realExtensionsDir] : [];
		const exclusions = (plan.disabledExtensions ?? [])
			.filter((extension) => extension.origin !== "package")
			.filter(
				(extension) =>
					projectExtensionsDir === undefined || !isUnderPath(extension.entry, projectExtensionsDir),
			)
			.map((extension) => `-${extension.entry}`);
		const next = [...native, ...addDir, ...exclusions];
		if (next.length > 0) settings.extensions = next;
	}

	// --- packages ---
	const userPackages = Array.isArray(userSettings.packages) ? userSettings.packages : [];
	if (userPackages.length > 0) {
		const packageSkills = new Map<string, string[]>();
		if (skillsDeclared) {
			for (const skill of plan.skills) {
				if (skill.origin !== "package" || skill.baseDir === undefined) continue;
				const list = packageSkills.get(skill.source) ?? [];
				list.push(toPosix(path.relative(skill.baseDir, skill.filePath)));
				packageSkills.set(skill.source, list);
			}
		}
		// Overlay exclusions on an undeclared kind join this package's native
		// filter as package-relative force-exclusions.
		const disabledPackageSkills = new Map<string, string[]>();
		if (!skillsDeclared) {
			for (const skill of plan.disabledSkills ?? []) {
				if (skill.origin !== "package" || skill.baseDir === undefined) continue;
				const list = disabledPackageSkills.get(skill.source) ?? [];
				list.push(toPosix(path.relative(skill.baseDir, skill.filePath)));
				disabledPackageSkills.set(skill.source, list);
			}
		}
		const disabledPackageExtensions = new Map<string, string[]>();
		if (!extensionsDeclared) {
			for (const extension of plan.disabledExtensions ?? []) {
				if (extension.origin !== "package") continue;
				const owner = packageRoots.find((pkg) => isUnderPath(extension.entry, pkg.root));
				if (owner === undefined) continue;
				const list = disabledPackageExtensions.get(owner.source) ?? [];
				list.push(toPosix(path.relative(owner.root, extension.entry)));
				disabledPackageExtensions.set(owner.source, list);
			}
		}
		settings.packages = userPackages.map((pkg) => {
			const source = typeof pkg === "string" ? pkg : (pkg as { source: string }).source;
			const base: Record<string, unknown> =
				typeof pkg === "object" && pkg !== null ? { ...(pkg as Record<string, unknown>) } : { source };
			const rewritten: Record<string, unknown> = { source, ...base };
			// A declared kind replaces the package's filter with its allowlist; an
			// undeclared kind keeps the native filter (or its absence), with an
			// existing empty native filter staying empty. The two kinds are always
			// rewritten independently.
			if (skillsDeclared) {
				rewritten.skills = packageSkills.get(source) ?? [];
			} else {
				const next = appendPackageExclusions(base.skills, disabledPackageSkills.get(source));
				if (next === undefined) delete rewritten.skills;
				else rewritten.skills = next;
			}
			if (extensionsDeclared) {
				rewritten.extensions = packageExtensions.get(source) ?? [];
			} else {
				const next = appendPackageExclusions(base.extensions, disabledPackageExtensions.get(source));
				if (next === undefined) delete rewritten.extensions;
				else rewritten.extensions = next;
			}
			return rewritten;
		});
	}

	// --- unmanaged dirs pass through (prompts/themes) ---
	for (const kind of UNMANAGED_DIR_KINDS) {
		const resourceDir = path.join(agentDir, kind);
		if (existsSync(resourceDir)) {
			const entries = Array.isArray(settings[kind]) ? (settings[kind] as unknown[]) : [];
			settings[kind] = [...entries, resourceDir];
		}
	}

	// --- profile defaults (Ticket 04) ---
	if (plan.model !== undefined) {
		settings.defaultProvider = plan.model.provider;
		settings.defaultModel = plan.model.id;
		if (plan.model.thinkingLevel !== undefined) {
			settings.defaultThinkingLevel = plan.model.thinkingLevel;
		} else {
			delete settings.defaultThinkingLevel;
		}
	}
	if (plan.tools !== undefined) {
		settings.defaultTools = plan.tools;
	}

	// Project auto-discovery is suppressed entirely; selected project
	// resources enter additively through the trust-gated resolver.
	settings.defaultProjectTrust = "never";
	return settings;
}

export interface RuntimeFileOptions {
	/** The user's real agent dir (e.g. ~/.pi/agent). */
	agentDir: string;
	/** Optional home dir override (useful for testing). */
	homeDir?: string;
	/** Optional trusted project dir. */
	projectDir?: string;
	/** Required for selection plans; unused for the default profile. */
	discovery?: DiscoveryContext;
	/** Extra launch-plan fields written by the in-session switch path:
	 *  `switchedFrom` triggers the one-shot change summary; `persistSelection`
	 *  tells the post-reload extension instance to save the selection;
	 *  `clearOverlay` drops the stored overlay
	 *  (a profile switch discards the previous profile's overlay).
	 *  `previousResolved` carries the pre-switch resolved name sets so
	 *  `/profile status` can report glob deltas (ticket 07). */
	planExtras?: {
		switchedFrom?: string;
		persistSelection?: boolean;
		clearOverlay?: boolean;
		previousResolved?: ResolvedNames;
	};
}

function applyDeclaredSubagents(
	settings: Record<string, unknown>,
	plan: ActivationPlan,
	settingsPath: string,
): Record<string, unknown> {
	try {
		return applySubagentSettings(settings, plan.subagents, { profile: plan.profile, settingsPath });
	} catch (error) {
		if (error instanceof SubagentSettingsError) throw new ActivationError(error.message);
		throw error;
	}
}

/** Computes the generated settings for a plan (pure-ish: reads the user's
 *  real settings + unmanaged dir existence, writes nothing). */
async function computeSettings(
	plan: ActivationPlan,
	options: RuntimeFileOptions,
	runtimeDir: string,
): Promise<Record<string, unknown>> {
	const { agentDir } = options;
	const userSettingsPath = path.join(agentDir, "settings.json");
	const userSettings: Record<string, unknown> = (await exists(userSettingsPath))
		? JSON.parse(await readFile(userSettingsPath, "utf8"))
		: {};

	if (plan.filter === "none") {
		// default profile: the user's global settings plus re-inclusion of the
		// real agent dir's resource dirs. User-defined keys, including their own
		// resource patterns and enable/disable state, are preserved untouched.
		// Project settings are NOT merged here: with native trust behavior, Pi
		// reads the project's settings itself.
		const settings = { ...userSettings };
		for (const kind of RESOURCE_DIR_KINDS) {
			const resourceDir = path.join(agentDir, kind);
			if (await exists(resourceDir)) {
				const entries = Array.isArray(settings[kind]) ? (settings[kind] as unknown[]) : [];
				settings[kind] = [...entries, resourceDir];
			}
		}
		return applyDeclaredSubagents(settings, plan, userSettingsPath);
	}

	// Selection plans: only user-scope encoding is layered onto the user's own
	// settings. The trusted project's `.pi/settings.json` is deliberately NOT
	// merged here — Pi reads it natively for the same trust decision this
	// process's Pi applies, and merging it would turn the project's `packages`
	// into global-scope packages (installing them into the real agent dir's npm
	// root as a launch side effect).
	const settings = buildSelectionSettings(
		plan,
		{ ...userSettings },
		agentDir,
		options.discovery ?? { skills: [], packages: [] },
		runtimeDir,
		options.projectDir,
	);
	return applyDeclaredSubagents(settings, plan, userSettingsPath);
}

/** Resolved name sets, carried in the launch plan for glob-delta reporting. */
export interface ResolvedNames {
	skills: string[];
	extensions: string[];
	tools?: string[];
	mcps?: string[];
}

/** Writes settings.json + pi-profile.json into an existing runtime dir and
 *  keeps the trust.json link in place for every profile: Pi reads its
 *  project-scope decision from that path, and project-level resources belong
 *  to Pi's trust gate rather than to the profile.
 *
 *  All generated content (settings, launch plan, MCP snapshot, diagnostics)
 *  is prepared in memory before any runtime file is touched, so a discovery
 *  failure can never leave a half-written runtime dir (D3). */
export async function writeRuntimeFiles(
	runtimeDir: string,
	plan: ActivationPlan,
	options: RuntimeFileOptions,
): Promise<{ warnings: string[] }> {
	const warnings: string[] = [];
	const settings = await computeSettings(plan, options, runtimeDir);

	// Prepare the MCP snapshot and diagnostics before the write stage. A
	// declared mcps or nonempty mcp_tools policy is strict; an undeclared
	// policy diagnoses malformed sources by path and keeps valid ones (D2).
	const hasMcpPolicy =
		plan.mcps !== undefined || (plan.mcpTools !== undefined && Object.keys(plan.mcpTools).length > 0);
	const discovery = await loadMergedMcpServers(
		options.agentDir,
		options.projectDir,
		{
			...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
			invalidSource: hasMcpPolicy ? "throw" : "diagnose",
		},
	);
	warnings.push(...(discovery.diagnostics ?? []));
	const instanceMcpConfig = buildInstanceMcpConfig(plan.profile, discovery, plan.mcps, plan.mcpTools);

	// When a profile narrows `tools` and the effective MCP set still has an
	// enabled server, keep Pi's native MCP discovery entry points reachable
	// (D4). The marker drives the session-start preservation; the
	// defaultTools baseline covers the boot window before session_start.
	const mcpGateways = plan.tools !== undefined && hasEnabledMcpServer(instanceMcpConfig, discovery);
	if (mcpGateways) {
		const current = Array.isArray(settings.defaultTools) ? (settings.defaultTools as string[]) : [];
		settings.defaultTools = [
			...current,
			...MCP_GATEWAY_TOOL_NAMES.filter((name) => !current.includes(name)),
		];
	}

	// The launch plan feeds the in-pi extension: tool re-application after
	// reload (the tools strict allowlist), in-session switching, status
	// reporting, and post-reload state persistence.
	// agentDir is the REAL agent dir — the extension needs it for trust
	// checks, state files, and catalog reads (its own
	// PI_CODING_AGENT_DIR points at this runtime dir).
	const launchPlan = {
		profile: plan.profile,
		source: plan.source,
		agentDir: options.agentDir,
		...(plan.subagents !== undefined ? { subagents: plan.subagents } : {}),
		...(plan.tools !== undefined ? { tools: plan.tools } : {}),
		...(plan.toolReferences !== undefined ? { toolReferences: plan.toolReferences } : {}),
		...(plan.disabledTools !== undefined ? { disabledTools: plan.disabledTools } : {}),
		...(plan.mcps !== undefined ? { mcps: plan.mcps } : {}),
		...(plan.mcpTools !== undefined ? { mcpTools: plan.mcpTools } : {}),
		...(mcpGateways ? { mcpGateways: true } : {}),
		// The resolved sets feed /profile status (absolute paths) and the
		// glob-delta diff against the previous activation.
		resolved: {
			skills: plan.skills.map((skill) => ({ name: skill.name, filePath: skill.filePath })),
			extensions: plan.extensions,
		},
		// Zero-match glob references (ADR-0009) — surfaced by /profile status
		// so a typo'd glob is visible instead of silently selecting nothing.
		...(plan.unmatched !== undefined ? { unmatched: plan.unmatched } : {}),
		...options.planExtras,
	};

	// --- write stage: all content is ready; no reads re-run here. ---
	await writeFile(path.join(runtimeDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
	await writeFile(path.join(runtimeDir, "pi-profile.json"), `${JSON.stringify(launchPlan, null, 2)}\n`);

	// Every profile gets the link, dangling allowed: Pi's stored trust decision
	// is what makes a trusted project's resources visible, and a decision Pi
	// writes through the link must land in the real agent dir (same shape as the
	// auth.json seed in ADR-0010). An entry that already exists is left alone —
	// a real file Pi wrote during this session carries its own decision.
	const trustLink = path.join(runtimeDir, "trust.json");
	if (!(await existsLexical(trustLink))) {
		await symlink(path.join(options.agentDir, "trust.json"), trustLink);
	}

	// MCP Servers generation: the instance mcp.json is always a generated
	// snapshot of the merged user-level configuration; it is never a symlink
	// or a copy of the real agentDir file (ADR-0016). The replacement content
	// was prepared above, so the old file is removed only once its successor
	// is ready to write.
	const mcpInstancePath = path.join(runtimeDir, "mcp.json");
	try { await rm(mcpInstancePath); } catch {}
	await writeFile(mcpInstancePath, JSON.stringify(instanceMcpConfig, null, 2));

	// Instructions generation (Ticket 04)
	const appendSystemPath = path.join(runtimeDir, "APPEND_SYSTEM.md");
	if (plan.instructions !== undefined && plan.instructions.trim() !== "") {
		await writeFile(appendSystemPath, plan.instructions);
	} else {
		try { await rm(appendSystemPath); } catch {}
	}

	// Full-fidelity symlink mirroring and dangling link cleanup (Ticket 02).
	await syncAgentSymlinks(options.agentDir, runtimeDir);

	return { warnings };
}

/**
 * Full-fidelity symlink mirroring of the user's real agentDir into runtimeDir (Ticket 02).
 * - Excludes profile-managed files.
 * - Mirrors both file and directory symlinks.
 * - Detects and cleans up dangling or obsolete symlinks in runtimeDir.
 * - Avoids recreating identical existing symlinks to minimize startup I/O.
 */
export async function syncAgentSymlinks(agentDir: string, runtimeDir: string): Promise<void> {
	if (!existsSync(agentDir)) return;
	if (path.resolve(agentDir) === path.resolve(runtimeDir)) return;

	// 1. Clean up dangling or obsolete symlinks in runtimeDir
	try {
		const runtimeEntries = await readdir(runtimeDir);
		for (const name of runtimeEntries) {
			if (MANAGED_INSTANCE_FILES.has(name)) continue;
			const linkPath = path.join(runtimeDir, name);
			const target = path.join(agentDir, name);
			try {
				const linkStat = await lstat(linkPath);
				if (linkStat.isSymbolicLink()) {
					if (!existsSync(target)) {
						await rm(linkPath, { recursive: true, force: true });
					}
				}
			} catch {
				// Best-effort cleanup
			}
		}
	} catch {}

	// 2. Seed the state paths this process's Pi will create at runtime, so their
	// writes land in the real agent dir instead of an instance-local copy
	// (ADR-0010). Runs after the cleanup above, which would otherwise remove the
	// deliberately dangling file links.
	await seedRuntimeState(agentDir, runtimeDir);

	// 3. Mirror files and directories from agentDir to runtimeDir
	try {
		const entries = await readdir(agentDir);
		for (const name of entries) {
			if (MANAGED_INSTANCE_FILES.has(name)) continue;

			const target = path.join(agentDir, name);
			const linkPath = path.join(runtimeDir, name);

			try {
				const linkStat = await lstat(linkPath).catch(() => null);
				if (linkStat) {
					if (linkStat.isSymbolicLink()) {
						const currentTarget = await readlink(linkPath).catch(() => null);
						if (currentTarget === target) {
							continue;
						}
					}
					await rm(linkPath, { recursive: true, force: true });
				}

				const info = await stat(target);
				await symlink(target, linkPath, info.isDirectory() ? "dir" : "file");
			} catch {
				// Ignore broken source links or unreadable files
			}
		}
	} catch {}
}

/** Ensures the runtime state paths exist (or are linked) in the real agent dir
 *  and the instance. Best-effort: a failure here leaves the path unseeded, and
 *  the sweep's unrecognized-entry warning names it later. */
async function seedRuntimeState(agentDir: string, runtimeDir: string): Promise<void> {
	for (const name of SEEDED_STATE_DIRS) {
		try {
			await mkdir(path.join(agentDir, name), { recursive: true });
		} catch {
			// Best-effort: the mirror then simply links nothing for this name.
		}
	}

	for (const name of SEEDED_STATE_FILES) {
		const linkPath = path.join(runtimeDir, name);
		// A real file here belongs to an earlier run of a different layout, and a
		// link may already point somewhere else: leave both alone rather than
		// replacing state pi-profile cannot attribute.
		if (await existsLexical(linkPath)) continue;
		try {
			await symlink(path.join(agentDir, name), linkPath);
		} catch {
			// Best-effort: Pi then creates the file inside the instance, and the
			// sweep keeps that directory instead of deleting it silently.
		}
	}
}

export async function generateRuntimeDir(
	plan: ActivationPlan,
	options: GenerateOptions,
): Promise<GeneratedRuntime> {
	const { agentDir } = options;
	const runtimeRoot = getInstancesRootDir();
	await mkdir(runtimeRoot, { recursive: true });
	// One instance per launch, never reused: PI_CODING_AGENT_DIR is frozen for
	// the life of the spawned process, so a stable path cannot follow an
	// in-session switch, and a shared path would make concurrent launches (and
	// their switches) rewrite each other's files (ADR-0010).
	const runtimeDir = await mkdtemp(path.join(runtimeRoot, "launch-"));

	const { warnings } = await writeRuntimeFiles(runtimeDir, plan, options);

	return {
		runtimeDir,
		env: {
			PI_CODING_AGENT_DIR: runtimeDir,
		},
		warnings,
	};
}
