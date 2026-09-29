/**
 * ApplyLaunchPlan: applies the launch plan inside a running Pi after every
 * session start (startup, reload, new/resume/fork) — the post-reload half of
 * switching (ticket 05).
 *
 * The freshly re-executed pi-profile extension calls this from its
 * `session_start` handler. It is dependency-injected against a narrow pi
 * surface so unit tests never need a real Pi.
 *
 * Steps:
 *   1. tools: re-expand the profile's raw references against Pi's LIVE
 *      non-MCP tool registry and call setActiveTools while retaining
 *      adapter-owned registrations. Settings `defaultTools` provides only
 *      the boot baseline for built-ins. Literals that no Pi tool provides
 *      are dropped with a warning — Pi silently ignores unknown names, so
 *      the warning is the only signal.
 *      When the plan carries overlay disabled tool entries, the active set
 *      is the base expansion — the profile references, or the whole live
 *      registry when the profile declares none — minus the entries' live
 *      matches, re-expanded at this moment so registry drift re-applies
 *      correctly after reload.
 *   2. persistence: when the plan is marked `persistSelection` and this is a
 *      reload, save the selection (activeProfile = plan.profile) to the
 *      profile's scope state file. Launch-transient selections never write.
 *   3. change summary: a `switchedFrom` marker produces a one-shot summary
 *      for the next agent turn and is cleared from the plan file.
 *
 * Pi's reload re-executes extension modules, so no stale handler or command
 * context survives; this module is the only place post-reload state is
 * established.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { isRecord, readJsonFile } from "../json-file.ts";
import { RuntimeStateStore } from "../runtime-state-store.ts";
import { getGlobalStateDir } from "../workspace.ts";
import { expandToolReferences } from "./tool-references.ts";

export interface LaunchPlanFile {
	profile: string;
	source: string;
	agentDir?: string;
	tools?: string[];
	toolReferences?: string[];
	/** Overlay tool disable entries (names or globs, verbatim); subtracted
	 *  from the base expansion at session start. */
	disabledTools?: string[];
	mcps?: string[];
	mcpTools?: Record<string, string[]>;
	switchedFrom?: string;
	persistSelection?: boolean;
	clearOverlay?: boolean;
	resolved?: {
		skills: Array<{ name: string; filePath: string }>;
		extensions: Array<{ id: string; entry: string; origin?: "package" | "local" | "path" }>;
	};
	/** Glob references that matched nothing at resolution (ADR-0009). */
	unmatched?: string[];
	previousResolved?: {
		skills: string[];
		extensions: string[];
		tools?: string[];
		mcps?: string[];
	};
}

/** The narrow slice of ExtensionAPI/Context the application needs. */
export interface PlanApplicationSurface {
	getAllTools(): Array<{
		name: string;
		sourceInfo?: { path?: string; source?: string };
	}>;
	setActiveTools(names: string[]): void;
	notify?(message: string, level: "info" | "warning" | "error"): void;
}

export interface ApplyResult {
	/** One-shot profile-change summary for the next agent turn, if any. */
	summary?: string;
	warnings: string[];
}

export async function readLaunchPlanFile(runtimeDir: string): Promise<LaunchPlanFile | undefined> {
	const result = await readJsonFile(path.join(runtimeDir, "pi-profile.json"));
	if (!result.ok || !isRecord(result.value) || typeof result.value.profile !== "string") {
		return undefined;
	}
	return result.value as unknown as LaunchPlanFile;
}

interface AdapterAttribution {
	/** Exact adapter entry paths (loose adapter files). */
	exactEntries: string[];
	/** Verified pi-mcp-adapter npm package roots. */
	packageRoots: string[];
}

async function resolveAdapterPackageRoot(entryPath: string): Promise<string | undefined> {
	let current = path.resolve(entryPath);
	while (true) {
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
		try {
			const manifest: unknown = JSON.parse(await readFile(path.join(current, "package.json"), "utf8"));
			if (isRecord(manifest) && manifest.name === "pi-mcp-adapter") {
				return current;
			}
		} catch {
			// Continue walking toward the filesystem root.
		}
	}
}

async function getAdapterAttribution(plan: LaunchPlanFile): Promise<AdapterAttribution> {
	const exactEntries: string[] = [];
	const packageRoots: string[] = [];
	for (const ext of plan.resolved?.extensions ?? []) {
		if (ext.origin === "package") {
			const packageName = ext.id.split(":", 1)[0]!;
			if (packageName === "pi-mcp-adapter") {
				const root = await resolveAdapterPackageRoot(ext.entry);
				if (root !== undefined) {
					packageRoots.push(root);
				}
			}
		} else if (ext.id === "pi-mcp-adapter") {
			// Loose adapter files (and plan entries without an origin marker)
			// own only their exact entry; siblings such as
			// "pi-mcp-adapter/linter" do not become adapter-owned.
			exactEntries.push(ext.entry);
		}
	}
	return { exactEntries, packageRoots };
}

export function isMcpOwnedTool(
	tool: { name: string; sourceInfo?: { path?: string; source?: string } },
	attribution?: AdapterAttribution,
): boolean {
	const info = tool.sourceInfo;
	if (!info) return false;
	if (info.source === "pi-mcp-adapter" || info.source === "mcp") return true;
	if (typeof info.path !== "string" || attribution === undefined) return false;
	if (attribution.exactEntries.includes(info.path)) return true;
	for (const root of attribution.packageRoots) {
		const rel = path.relative(root, info.path);
		if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
			return true;
		}
	}
	return false;
}

/** Applies the plan carried by the runtime dir's pi-profile.json. */
export async function applyLaunchPlan(input: {
	runtimeDir: string;
	cwd: string;
	/** The session_start reason ("startup" | "reload" | "new" | ...). */
	reason: string;
	surface: PlanApplicationSurface;
}): Promise<ApplyResult> {
	const { surface } = input;
	const plan = await readLaunchPlanFile(input.runtimeDir);
	if (plan === undefined) {
		return { warnings: [] };
	}
	const warnings: string[] = [];

	// --- tools ---
	const hasOverlayDisables = plan.disabledTools !== undefined && plan.disabledTools.length > 0;
	if (plan.toolReferences !== undefined || hasOverlayDisables) {
		const allTools = surface.getAllTools();
		const attribution = await getAdapterAttribution(plan);
		const mcpToolNames: string[] = [];
		const nonMcpToolNames: string[] = [];

		for (const tool of allTools) {
			if (isMcpOwnedTool(tool, attribution)) {
				mcpToolNames.push(tool.name);
			} else {
				nonMcpToolNames.push(tool.name);
			}
		}

		let active: string[];
		if (plan.toolReferences !== undefined) {
			const { expanded, droppedLiterals, legacyMcpReferences } = expandToolReferences(
				plan.toolReferences,
				nonMcpToolNames,
				mcpToolNames,
			);
			if (droppedLiterals.length > 0) {
				warnings.push(
					`profile "${plan.profile}": tools ${droppedLiterals.map((name) => JSON.stringify(name)).join(", ")} match nothing in Pi's live registry`,
				);
			}
			if (legacyMcpReferences.length > 0) {
				for (const ref of legacyMcpReferences) {
					warnings.push(
						`profile "${plan.profile}": tool reference ${JSON.stringify(ref)} matched only MCP tools; migrate MCP tool configuration to "mcp_tools"`,
					);
				}
			}
			// Retain MCP-owned tools in the live registry alongside selected Pi tools
			active = [...expanded, ...mcpToolNames];
		} else {
			// No declared tools: the base is the whole live registry.
			active = allTools.map((tool) => tool.name);
		}

		if (hasOverlayDisables) {
			const allLiveNames = allTools.map((tool) => tool.name);
			const { expanded: disabled, droppedLiterals: vanishedEntries } = expandToolReferences(
				plan.disabledTools!,
				allLiveNames,
				mcpToolNames,
			);
			if (vanishedEntries.length > 0) {
				warnings.push(
					`profile "${plan.profile}": overlay tool entries ${vanishedEntries.map((name) => JSON.stringify(name)).join(", ")} match nothing in Pi's live registry`,
				);
			}
			const disabledSet = new Set(disabled);
			active = active.filter((name) => !disabledSet.has(name));
		}
		surface.setActiveTools(active);
	}

	// --- persistence (post-reload only) ---
	if (plan.persistSelection === true && input.reason === "reload" && plan.agentDir !== undefined) {
		const stateDir = plan.source === "project" ? path.join(input.cwd, ".pi") : getGlobalStateDir(plan.agentDir);
		// Merge: the overlay belongs to the overlay commands, not to this
		// write. A switch (clearOverlay) explicitly drops it.
		await new RuntimeStateStore(stateDir).update({
			activeProfile: plan.profile,
			...(plan.clearOverlay === true ? { overlay: undefined } : {}),
		});
	}

	// --- one-shot change summary ---
	let summary: string | undefined;
	if (typeof plan.switchedFrom === "string" && plan.switchedFrom.length > 0) {
		summary = buildSwitchSummary(plan);
		surface.notify?.(summary, "info");
		await clearSwitchMarker(input.runtimeDir);
	}

	for (const warning of warnings) {
		surface.notify?.(warning, "warning");
	}
	return { summary, warnings };
}

function buildSwitchSummary(plan: LaunchPlanFile): string {
	const parts = [
		`profile switched: ${plan.switchedFrom} → ${plan.profile}`,
		plan.tools !== undefined ? `tools: [${plan.tools.join(", ")}]` : undefined,
		plan.mcps !== undefined && plan.mcps.length > 0 ? `mcp: [${plan.mcps.join(", ")}]` : undefined,
	].filter((part): part is string => part !== undefined);
	return parts.join("; ");
}

/** Clears the one-shot marker so the summary fires exactly once, even
 *  across later reloads. */
async function clearSwitchMarker(runtimeDir: string): Promise<void> {
	const plan = await readLaunchPlanFile(runtimeDir);
	if (plan === undefined) return;
	delete plan.switchedFrom;
	await writeFile(path.join(runtimeDir, "pi-profile.json"), `${JSON.stringify(plan, null, 2)}\n`);
}
