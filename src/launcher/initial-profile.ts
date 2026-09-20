/**
 * Initial profile resolution for the launcher.
 *
 * Flow: trust check (gatekeeper for everything project-scoped) → positional
 * name or saved state (project state wins when trusted) → catalog lookup →
 * discovery (skills, extensions, MCP server names) → resolver (glob
 * expansion, overlay, model validation) → ActivationPlan + full discovery
 * results for the settings generator. Unknown profiles, malformed catalogs,
 * and unresolvable resources all fail before Pi spawns.
 *
 * The CLI's initial selection is transient: no runtime state is written here.
 */

import path from "node:path";

import { isRecord, readJsonFile } from "../json-file.ts";
import { discoverAdapterServerNames } from "../mcp-config.ts";
import { isAdapterExtension, MissingMcpAdapterError } from "../mcp-config.ts";
import { ProfileCatalog, type ResolvedProfile } from "../profile-catalog.ts";
import { ActivationError, defaultPlan, resolveProfile, type ActivationPlan } from "../profile-resolver.ts";
import { resolveProjectTrust } from "../project-trust.ts";
import { RuntimeStateStore, type RuntimeOverlay } from "../runtime-state-store.ts";
import { getGlobalStateDir } from "../workspace.ts";
import { discoverLauncherResources, type LauncherDiscovery } from "./discovery.ts";
import { checkDeclaredModel } from "./model-check.ts";

export class UnknownProfileError extends Error {
	constructor(name: string) {
		super(`unknown profile: ${name}`);
		this.name = "UnknownProfileError";
	}
}

/** Zero-match glob references surface as launch warnings (ADR-0009):
 *  visible, but never blocking — globs re-expand on every resolution. */
function unmatchedWarnings(plan: ActivationPlan): string[] {
	return (plan.unmatched ?? []).map(
		(reference) => `profile "${plan.profile}": "${reference}" matched nothing this resolution`,
	);
}

export interface LauncherContext {
	/** The user's real agent dir (e.g. ~/.pi/agent). */
	agentDir: string;
	/** The project working directory Pi will run in. */
	cwd: string;
	/** One-run trust input from --approve / --no-approve (never forwarded to Pi). */
	trustOverride?: boolean;
}

export interface InitialProfile {
	plan: ActivationPlan;
	/** Full discovery results for the settings generator. Undefined for the
	 *  default profile (which applies no filtering). */
	discovery?: LauncherDiscovery;
	/** The trusted project directory, when trusted. */
	projectDir?: string;
	/** Non-fatal notices for the user (e.g. a dangling restored profile that
	 *  fell back to default). The launcher prints them. */
	warnings: string[];
}

/** Reads the real global `defaultProjectTrust` setting (a trust input) and
 *  resolves the project trust decision from Pi's own trust store. Exported
 *  for the session-side surfaces (selector/list/status) that need the same
 *  trust gate the launcher uses. */
export async function readTrustInputs(context: LauncherContext): Promise<{
	projectTrusted: boolean;
}> {
	const globalSettingsPath = path.join(context.agentDir, "settings.json");
	const globalSettings = await readJsonFile(globalSettingsPath);
	const userDefaultProjectTrust =
		globalSettings.ok && isRecord(globalSettings.value) && typeof globalSettings.value.defaultProjectTrust === "string"
			? globalSettings.value.defaultProjectTrust
			: undefined;
	const projectTrusted = resolveProjectTrust({
		cwd: context.cwd,
		agentDir: context.agentDir,
		trustOverride: context.trustOverride,
		userDefaultProjectTrust,
	});
	if (!projectTrusted) {
		return { projectTrusted };
	}
	// The project's own `.pi/settings.json` is Pi's to read (natively, for the
	// same trust decision): pi-profile neither merges nor narrows it.
	return { projectTrusted };
}

export async function resolveInitialProfile(
	name: string | undefined,
	context: LauncherContext,
	options?: { overlay?: RuntimeOverlay },
): Promise<InitialProfile> {
	const { projectTrusted } = await readTrustInputs(context);
	const projectDir = projectTrusted ? context.cwd : undefined;
	const catalog = await ProfileCatalog.load(context.agentDir, { projectDir });

	let selected = name;
	const warnings: string[] = [];
	if (selected === undefined) {
		// No positional name: the trusted project's saved selection is the more
		// specific one and wins; otherwise the global state, then default.
		if (projectTrusted) {
			selected = (await new RuntimeStateStore(path.join(context.cwd, ".pi")).read()).activeProfile;
		}
		selected ??= (await new RuntimeStateStore(getGlobalStateDir(context.agentDir)).read()).activeProfile ?? "default";
	}

	const profile = catalog.resolve(selected);
	if (profile === undefined) {
		// Explicit positional selection fails loudly; a restored selection that
		// no longer exists falls back to default with a warning instead of
		// blocking the launch (restore is a convenience, not a commitment).
		if (name !== undefined) {
			throw new UnknownProfileError(selected);
		}
		warnings.push(`saved profile "${selected}" no longer exists; starting the default profile`);
		return { plan: defaultPlan(), warnings };
	}
	if (profile.source === "builtin") {
		// The default profile is normally unfiltered. With an overlay it becomes
		// a synthetic "everything minus disabled" selection (PRD: overlays may
		// temporarily narrow default's scope). MCP narrowing on default is
		// rejected — the adapter's own /mcp commands own that surface natively.
		const overlay = options?.overlay;
		const narrowed =
			overlay !== undefined &&
			((overlay.disabledSkills?.length ?? 0) > 0 ||
				(overlay.disabledExtensions?.length ?? 0) > 0 ||
				(overlay.disabledMcps?.length ?? 0) > 0 ||
				overlay.tools !== undefined);
		if (!narrowed) {
			return { plan: defaultPlan(), warnings };
		}
		if ((overlay.disabledMcps?.length ?? 0) > 0) {
			throw new ActivationError(
				"the default profile has no MCP allowlist to narrow — use the adapter's own /mcp commands instead",
			);
		}
		const synthetic: ResolvedProfile = {
			name: "default",
			source: "builtin",
			definition: { skills: ["*"], extensions: ["*"] },
		};
		const discovery = await discoverLauncherResources({ ...context, projectTrusted });
		const plan = await resolveProfile({
			profile: synthetic,
			skills: discovery.skills,
			extensions: discovery.extensions,
			overlay,
		});
		warnings.push(...discovery.extensions.warnings(), ...unmatchedWarnings(plan));
		return { plan, discovery, projectDir, warnings };
	}

	const discovery = await discoverLauncherResources({ ...context, projectTrusted });
	const plan = await resolveProfile({
		profile,
		skills: discovery.skills,
		extensions: discovery.extensions,
		validateModel: (model) => checkDeclaredModel(context.agentDir, model),
		discoveredMcpServers: profile.definition.mcps?.length
			? await discoverAdapterServerNames(context.agentDir, projectDir)
			: undefined,
		overlay: options?.overlay,
	});
	warnings.push(...discovery.extensions.warnings(), ...unmatchedWarnings(plan));
	if (plan.mcps !== undefined && !plan.extensions.some(isAdapterExtension)) {
		// Fail before spawn: without the adapter in the active extension set
		// nobody applies the allowlist, and the declared servers would either
		// silently do nothing or leak through unfiltered.
		throw new MissingMcpAdapterError(plan.profile);
	}
	return { plan, discovery, projectDir, warnings };
}
