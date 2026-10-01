/**
 * ProfileResolver: a pure function from profile + registries to an immutable
 * ActivationPlan.
 *
 * Rules:
 * - Glob references (`*`, `?`) expand against the full registry at every
 *   resolution; zero matches is fine (new matches join on the next start) and
 *   is reported in the plan's `unmatched` list so typos are visible.
 * - Literal references must exist; a missing literal fails activation.
 *   Extension references resolve through ExtensionDiscovery.select (ADR-0007):
 *   package name/alias, loose-file stem, or an on-disk path — no
 *   pre-registration required.
 * - Undeclared model/thinking/instructions never enter the plan, so Pi's
 *   current state stays untouched.
 * - MCP references (`mcps`) expand against the merged user-level MCP
 *   configuration snapshot: literal misses fail loudly; globs expand to zero
 *   or more matches (consistent with skills/extensions).
 * - Tool globs expand against Pi's built-in tool names for settings
 *   `defaultTools`; raw tool references are also carried into the launch
 *   plan so the in-session extension can expand them against Pi's live
 *   registry (including extension and MCP tools) via setActiveTools for
 *   strict allowlisting.
 */

import { minimatch } from "minimatch";

import type { DiscoveredExtensions } from "./extension-discovery.ts";
import { isRecord } from "./json-file.ts";
import type { MergedMcpResult } from "./mcp-config.ts";
import type { ProfileDefinition, ProfileModel, ProfileSource, ResolvedProfile } from "./profile-catalog.ts";

/** Extracts a ProfileModel from flat definition keys, if declared. */
function extractModel(definition: ProfileDefinition): ProfileModel | undefined {
	if (definition.defaultProvider === undefined || definition.defaultModel === undefined) return undefined;
	return {
		provider: definition.defaultProvider,
		id: definition.defaultModel,
		...(definition.defaultThinkingLevel !== undefined ? { thinkingLevel: definition.defaultThinkingLevel } : {}),
	};
}
import type { RuntimeOverlay } from "./runtime-state-store.ts";
import type { SkillEntry } from "./skill-registry.ts";

export class ActivationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ActivationError";
	}
}

/** Pi's built-in tool names (pi 0.85.1 `allToolNames`; not exported by the
 *  SDK). The integration suite guards drift. Literal tool names pass through
 *  regardless — extension-provided tools are unknowable before spawn. */
export const BUILTIN_TOOL_NAMES = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"] as const;

const VALID_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Immutable, fully resolved activation set. */
export interface ActivationPlan {
	profile: string;
	source: ProfileSource;
	/** "none" exposes everything Pi can discover (the default profile). */
	filter: "none" | "selection";
	/** Selected skills with their resolved SKILL.md paths. Empty for default. */
	skills: SkillEntry[];
	/** Selected extensions. Empty for default. */
	extensions: Array<{ id: string; entry: string; origin?: "package" | "local" | "path" }>;
	/** Expanded tool allowlist; undefined when the profile declares no tools. */
	tools?: string[];
	/** Overlay tool disable entries (names or globs, verbatim); undefined
	 *  when the overlay disables no tools. The session-start application
	 *  subtracts their live matches from the base expansion. */
	disabledTools?: string[];
	/** The raw tool references (globs included) for extension-side expansion
	 *  against Pi's live tool registry, which includes extension-provided
	 *  tools the pre-spawn expansion cannot know. Set iff `tools` is set. */
	toolReferences?: string[];
	/** Declared model; undefined leaves Pi's current model untouched. */
	model?: ProfileModel;
	/** Declared instructions; written to the generated APPEND_SYSTEM.md,
	 *  which Pi natively appends to the system prompt. */
	instructions?: string;
	/** Expanded MCP server allowlist: written by SettingsGenerator into the
	 *  instance `mcp.json` snapshot and surfaced in `/profile status`;
	 *  undefined when the profile declares no `mcps` (no restriction). */
	mcps?: string[];
	/** Per-server MCP tool policy: literal tool names per server. */
	mcpTools?: Record<string, string[]>;
	/** Prepared in-memory instance mcp.json config; never written to pi-profile.json */
	instanceMcpConfig?: Record<string, unknown>;
	/** Glob references (skills/extensions/MCP) that matched nothing this
	 *  resolution — surfaced as warnings so zero-match typos are never silent.
	 *  Tool globs are excluded: extension-contributed tools are unknowable
	 *  before spawn, so a pre-spawn zero-match proves nothing. */
	unmatched?: string[];
}

export interface ResolveInput {
	profile: ResolvedProfile;
	/** The full SkillRegistry result (not just selected skills). */
	skills: SkillEntry[];
	extensions: DiscoveredExtensions;
	/**
	 * Validates a declared model (exists and is authenticated) against the
	 * user's real model/auth state. Returns an error message or undefined.
	 * The launcher always provides this; a declared model without a validator
	 * fails activation rather than silently skipping the check.
	 */
	validateModel?: (model: ProfileModel) => Promise<string | undefined>;
	/**
	 * Server names discovered from the merged user-level MCP configuration
	 * snapshot (see mcp-config.ts). Required when the profile declares `mcps`
	 * or `mcp_tools`: without the discovered names a reference cannot be
	 * validated, so activation fails rather than passing references through
	 * unchecked.
	 */
	discoveredMcpServers?: string[];
	/**
	 * Merged MCP configuration result. Carries server definitions, ownership,
	 * and base settings.
	 */
	mcpDiscovery?: MergedMcpResult;
	/**
	 * The runtime overlay (ticket 06): temporary narrowing applied on top of
	 * the profile definition at every resolution. Overlay references must
	 * name resources the profile actually resolves (typos fail loudly), and
	 * any resolved reference may be narrowed or disabled.
	 */
	overlay?: RuntimeOverlay;
	/**
	 * Pi's live tool names (`pi.getAllTools()`), supplied by the in-session
	 * switch path. Required when the overlay disables tools on a profile
	 * without declared `tools` — the live registry is then the base set the
	 * entries disable from. The launcher never passes an overlay, so it never
	 * needs this.
	 */
	liveToolNames?: string[];
}

function isGlob(reference: string): boolean {
	return reference.includes("*") || reference.includes("?");
}

/** Expands overlay disable entries against the names the profile resolved.
 *  Entries are names or globs stored as written and
 *  re-expanded at every resolution; unmatched literals fail and identify
 *  the entry, zero-match globs join `unmatched` with an `overlay ` prefix.
 *  Overlays can disable any resolved extension. */
function expandDisableEntries(
	entries: string[],
	activeNames: readonly string[],
	kind: string,
	profileName: string,
	onZeroMatch: (entry: string) => void,
): Set<string> {
	const disabled = new Set<string>();
	for (const entry of entries) {
		if (isGlob(entry)) {
			let matched = 0;
			for (const name of activeNames) {
				if (minimatch(name, entry)) {
					disabled.add(name);
					matched += 1;
				}
			}
			if (matched === 0) onZeroMatch(entry);
			continue;
		}
		if (!activeNames.includes(entry)) {
			throw new ActivationError(`profile "${profileName}": overlay disables unknown ${kind} "${entry}"`);
		}
		disabled.add(entry);
	}
	return disabled;
}

/** Expands one reference list against a named universe. Literal misses fail
 *  when `literalMustExist`; globs expand to zero or more matches, and a
 *  zero-match glob is reported through `onZeroMatch`. */
function expandReferences<T>(
	references: string[],
	universe: readonly T[],
	nameOf: (item: T) => string,
	kind: string,
	options?: { literalMustExist?: boolean; onZeroMatch?: (reference: string) => void },
): T[] {
	const selected = new Map<string, T>();
	for (const reference of references) {
		if (isGlob(reference)) {
			let matched = 0;
			for (const item of universe) {
				if (minimatch(nameOf(item), reference)) {
					selected.set(nameOf(item), item);
					matched += 1;
				}
			}
			if (matched === 0) options?.onZeroMatch?.(reference);
			continue;
		}
		const item = universe.find((candidate) => nameOf(candidate) === reference);
		if (item === undefined) {
			if (options?.literalMustExist === false) {
				// Pass-through (e.g. extension-provided tool names).
				selected.set(reference, reference as T);
				continue;
			}
			throw new ActivationError(`unknown ${kind}: "${reference}" does not match any discovered ${kind}`);
		}
		selected.set(reference, item);
	}
	return [...selected.values()];
}

/** The built-in default profile: everything Pi can discover, no filtering. */
export function defaultPlan(): ActivationPlan {
	return { profile: "default", source: "builtin", filter: "none", skills: [], extensions: [] };
}

export async function resolveProfile(input: ResolveInput): Promise<ActivationPlan> {
	const { profile, skills, extensions, overlay } = input;
	const definition: ProfileDefinition = profile.definition;
	const unmatched: string[] = [];

	if (input.mcpDiscovery !== undefined && input.discoveredMcpServers === undefined) {
		input.discoveredMcpServers = Object.keys(input.mcpDiscovery.servers).sort();
	}

	let selectedSkills = expandReferences(definition.skills ?? [], skills, (skill) => skill.name, "skill", {
		onZeroMatch: (reference) => unmatched.push(`skill:${reference}`),
	});

	// Extension references resolve directly against discovered extensions.
	const selection = await extensions.select(definition.extensions ?? []);
	for (const reference of selection.unmatched) unmatched.push(`extension:${reference}`);
	let planExtensions: Array<{ id: string; entry: string; origin?: "package" | "local" | "path" }> = selection.entries.map(
		(entry) => ({
			id: entry.id,
			entry: entry.entry,
			...(entry.origin ? { origin: entry.origin } : {}),
		}),
	);

	let mcps: string[] | undefined;
	if (definition.mcps !== undefined) {
		if (definition.mcps.length > 0) {
			if (input.discoveredMcpServers === undefined) {
				throw new ActivationError(
					`profile "${profile.name}" declares MCP servers but no MCP server discovery is available`,
				);
			}
			mcps = expandReferences(definition.mcps, input.discoveredMcpServers, (name) => name, "MCP server", {
				onZeroMatch: (reference) => unmatched.push(`mcp:${reference}`),
			});
			if (input.mcpDiscovery !== undefined) {
				const discovery = input.mcpDiscovery;
				const projectNamed = mcps.find(
					(name) => discovery.serverOwners[name] === "project" || discovery.projectServers.has(name),
				);
				if (projectNamed !== undefined) {
					throw new ActivationError(
						`profile "${profile.name}": cannot select project-level MCP server "${projectNamed}" (project-level servers are outside profile selection)`,
					);
				}
			}
		} else {
			// Explicitly empty mcps: requires discovery so the empty selection
			// disables every discovered user-level server.
			if (input.mcpDiscovery === undefined) {
				throw new ActivationError(
					`profile "${profile.name}" declares an empty MCP server selection but no MCP server discovery is available`,
				);
			}
			mcps = [];
		}
	}

	// --- overlay narrowing (ticket 06) ---
	if (overlay !== undefined) {
		if (overlay.disabledSkills !== undefined && overlay.disabledSkills.length > 0) {
			const disabled = expandDisableEntries(
				overlay.disabledSkills,
				selectedSkills.map((skill) => skill.name),
				"skill",
				profile.name,
				(entry) => unmatched.push(`overlay skill:${entry}`),
			);
			selectedSkills = selectedSkills.filter((skill) => !disabled.has(skill.name));
		}
		if (overlay.disabledExtensions !== undefined && overlay.disabledExtensions.length > 0) {
			const disabled = expandDisableEntries(
				overlay.disabledExtensions,
				planExtensions.map((entry) => entry.id),
				"extension",
				profile.name,
				(entry) => unmatched.push(`overlay extension:${entry}`),
			);
			planExtensions = planExtensions.filter((entry) => !disabled.has(entry.id));
		}
		if (overlay.disabledMcps !== undefined && overlay.disabledMcps.length > 0) {
			const active = mcps ?? [];
			const disabled = expandDisableEntries(
				overlay.disabledMcps,
				active,
				"MCP server",
				profile.name,
				(entry) => unmatched.push(`overlay mcp:${entry}`),
			);
			// A profile that declared no `mcps` has no MCP restriction; overlay
			// narrowing must not turn that into an empty whitelist. Literals
			// still fail and zero-match globs still warn — the expansion above
			// runs either way — only the reassignment is guarded.
			if (mcps !== undefined) {
				mcps = active.filter((name) => !disabled.has(name));
			}
		}
	}

	const mcpToolsDef = (definition as ProfileDefinition & { mcp_tools?: Record<string, string[]> }).mcp_tools;
	const mcpToolKeys = mcpToolsDef !== undefined ? Object.keys(mcpToolsDef) : [];

	let mcpTools: Record<string, string[]> | undefined;
	if (mcpToolKeys.length > 0) {
		if (input.mcpDiscovery === undefined) {
			throw new ActivationError(
				`profile "${profile.name}" declares MCP tools but no MCP server discovery is available`,
			);
		}

		const mcpDiscovery = input.mcpDiscovery;
		const usableCandidates = Object.keys(mcpDiscovery.servers)
			.filter((s) => {
				const isUser =
					Object.hasOwn(mcpDiscovery.serverOwners, s) &&
					mcpDiscovery.serverOwners[s] === "user" &&
					!mcpDiscovery.projectServers.has(s);
				const isEnabled = mcpDiscovery.servers[s]?.enabled !== false;
				const isAllowedByMcps = mcps === undefined || mcps.includes(s);
				return isUser && isEnabled && isAllowedByMcps;
			})
			.sort();
		const candidateMsg = usableCandidates.length > 0 ? ` (usable candidates: ${usableCandidates.join(", ")})` : "";

		for (const serverKey of mcpToolKeys) {
			if (!Object.hasOwn(mcpDiscovery.servers, serverKey)) {
				throw new ActivationError(`profile "${profile.name}": unknown MCP server "${serverKey}"${candidateMsg}`);
			}
			const isProject =
				mcpDiscovery.serverOwners[serverKey] === "project" || mcpDiscovery.projectServers.has(serverKey);
			if (isProject) {
				throw new ActivationError(
					`profile "${profile.name}": cannot narrow project-level MCP server "${serverKey}" (project-level servers are outside profile narrowing)`,
				);
			}
			const isDisabled =
				mcpDiscovery.servers[serverKey]?.enabled === false ||
				(mcps !== undefined && !mcps.includes(serverKey));
			if (isDisabled) {
				throw new ActivationError(`profile "${profile.name}": MCP server "${serverKey}" is disabled${candidateMsg}`);
			}
		}

		mcpTools = Object.fromEntries(
			Object.entries(mcpToolsDef ?? {}).map(([server, selectors]) => [server, [...selectors]]),
		);
	}

	const toolReferences = definition.tools;

	let instanceMcpConfig: Record<string, unknown> | undefined;
	if (input.mcpDiscovery !== undefined && (mcps !== undefined || mcpToolKeys.length > 0)) {
		instanceMcpConfig = buildInstanceMcpConfig(profile.name, input.mcpDiscovery, mcps, mcpTools);
	}

	let tools: string[] | undefined;
	if (toolReferences !== undefined) {
		tools = expandReferences(toolReferences, BUILTIN_TOOL_NAMES, (name) => name, "tool", {
			literalMustExist: false,
		});
	}

	// Tool disable entries join the uniform grammar: the base set is the
	// profile's resolved tool references when declared (expanded against the
	// live registry, which the in-session switch path always supplies) and
	// the live registry itself when the profile declares no tools. The
	// plan carries the entries verbatim; session-start application subtracts
	// their live matches from the base expansion at that moment.
	let disabledTools: string[] | undefined;
	if (overlay?.disabledTools !== undefined && overlay.disabledTools.length > 0) {
		if (input.liveToolNames === undefined) {
			throw new ActivationError(
				`profile "${profile.name}": overlay disables tools but no live tool registry is available`,
			);
		}
		const base =
			toolReferences !== undefined
				? expandReferences(toolReferences, input.liveToolNames, (name) => name, "tool", {
						literalMustExist: false,
					})
				: input.liveToolNames;
		const disabled = expandDisableEntries(
			overlay.disabledTools,
			base,
			"tool",
			profile.name,
			(entry) => unmatched.push(`overlay tool:${entry}`),
		);
		disabledTools = [...overlay.disabledTools];
		// The pre-computed boot baseline additionally subtracts the disabled
		// matches (a no-op for tools only the live registry knows).
		if (tools !== undefined) {
			tools = tools.filter((name) => !disabled.has(name));
		}
	}

	let model: ProfileModel | undefined;
	const declaredModel = extractModel(definition);
	if (declaredModel !== undefined) {
		const declared = declaredModel;
		if (declared.thinkingLevel !== undefined && !VALID_THINKING_LEVELS.has(declared.thinkingLevel)) {
			throw new ActivationError(
				`profile "${profile.name}": invalid thinkingLevel ${JSON.stringify(declared.thinkingLevel)}`,
			);
		}
		if (input.validateModel === undefined) {
			throw new ActivationError(`profile "${profile.name}" declares a model but no model validator is available`);
		}
		const error = await input.validateModel(declared);
		if (error !== undefined) {
			throw new ActivationError(`profile "${profile.name}": model ${declared.provider}/${declared.id}: ${error}`);
		}
		model = declared;
	}

	return {
		profile: profile.name,
		source: profile.source,
		filter: "selection",
		skills: selectedSkills,
		extensions: planExtensions.map((entry) => ({ id: entry.id, entry: entry.entry })),
		...(tools !== undefined && toolReferences !== undefined ? { tools, toolReferences: [...toolReferences] } : {}),
		...(disabledTools !== undefined ? { disabledTools } : {}),
		...(model !== undefined ? { model } : {}),
		...(definition.instructions !== undefined ? { instructions: definition.instructions } : {}),
		...(mcps !== undefined ? { mcps } : {}),
		...(mcpTools !== undefined ? { mcpTools } : {}),
		...(instanceMcpConfig !== undefined ? { instanceMcpConfig } : {}),
		...(unmatched.length > 0 ? { unmatched } : {}),
	};
}

function setOwnRecordValue<T>(record: Record<string, T>, key: string, value: T): void {
	Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true });
}

export function buildInstanceMcpConfig(
	profileName: string,
	mcpDiscovery: MergedMcpResult,
	mcps?: string[],
	mcpTools?: Record<string, string[]>,
): Record<string, unknown> {
	const filteredServers: Record<string, Record<string, unknown>> = {};
	const userServers = Object.keys(mcpDiscovery.servers).filter(
		(s) =>
			Object.hasOwn(mcpDiscovery.serverOwners, s) &&
			mcpDiscovery.serverOwners[s] === "user" &&
			!mcpDiscovery.projectServers.has(s),
	);

	const serversToInclude = mcps !== undefined ? mcps : userServers;
	for (const serverName of serversToInclude) {
		const originalDef = Object.hasOwn(mcpDiscovery.servers, serverName)
			? mcpDiscovery.servers[serverName]
			: undefined;
		if (originalDef === undefined) continue;

		// Project-owned servers are never materialized into the snapshot;
		// Pi reads the trusted project's .pi/mcp.json itself.
		const isProjectOwned =
			mcpDiscovery.serverOwners[serverName] === "project" || mcpDiscovery.projectServers.has(serverName);
		if (isProjectOwned) continue;

		// A selected server the winning source explicitly disables fails with a
		// fix, never a silent enablement override (D1).
		if (mcps?.includes(serverName) === true && originalDef.enabled === false) {
			throw new ActivationError(
				`profile "${profileName}": selected MCP server "${serverName}" is disabled in its source configuration; enable it there or remove it from "mcps"`,
			);
		}

		// A server explicitly selected by mcps whose definition uses a
		// transport Pi's built-in MCP extension cannot use fails activation.
		if (mcps?.includes(serverName) === true && originalDef.type === "sse") {
			throw new ActivationError(
				`profile "${profileName}": selected MCP server "${serverName}" uses the legacy SSE transport, which Pi does not support; switch to the server's streamable HTTP URL or remove it from "mcps"`,
			);
		}

		const def = { ...originalDef };

		if (mcpTools && Object.hasOwn(mcpTools, serverName)) {
			// Profile policy replaces the merged toolExposure wholesale.
			const requested = mcpTools[serverName];
			const exposure: Record<string, string> = { "*": "hidden" };
			for (const selector of requested) {
				exposure[selector] = "direct";
			}
			def.toolExposure = exposure;
		}

		setOwnRecordValue(filteredServers, serverName, def);
	}

	// Unselected user-level servers keep their complete winning definition and
	// are explicitly disabled. Pi validates the transport before `enabled`, so
	// a transport-less placeholder would warn on every valid disabled server.
	if (mcps !== undefined) {
		for (const userName of userServers) {
			if (mcps.includes(userName)) continue;
			const unselectedDef = mcpDiscovery.servers[userName] ?? {};
			setOwnRecordValue(filteredServers, userName, { ...unselectedDef, enabled: false });
		}
	}

	return isRecord(mcpDiscovery.baseConfig)
		? { ...mcpDiscovery.baseConfig, mcpServers: filteredServers }
		: { mcpServers: filteredServers };
}
