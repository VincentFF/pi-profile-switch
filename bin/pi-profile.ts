#!/usr/bin/env node
/**
 * pi-profile launcher (ADR-0005).
 *
 * Resolves the initial profile, materializes it as a generated runtime
 * directory (settings + symlinks + env), and spawns the real `pi`
 * binary with user arguments passed through verbatim.
 *
 * Usage:
 *   pi-profile                          # default profile
 *   pi-profile review                   # named profile (once catalogs land)
 *   pi-profile review -- --mode rpc --model openai/gpt-5.4
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { ExtensionError } from "../src/extension-discovery.ts";
import { parseLauncherArgs } from "../src/launcher/args.ts";
import { UnknownProfileError, resolveInitialProfile } from "../src/launcher/initial-profile.ts";
import { sweepStaleInstances } from "../src/launcher/runtime-cleanup.ts";
import { spawnPi } from "../src/launcher/spawn.ts";
import { McpConfigError, MissingMcpAdapterError } from "../src/mcp-config.ts";
import { CatalogError } from "../src/profile-catalog.ts";
import { ActivationError } from "../src/profile-resolver.ts";
import { generateRuntimeDir } from "../src/settings-generator.ts";

try {
	const args = parseLauncherArgs(process.argv.slice(2));
	const agentDir = getAgentDir();
	// Fails before spawning when the profile is unknown or cannot activate.
	// --approve/--no-approve are consumed here as a one-run trust input.
	const { plan, discovery, projectSettings, projectDir, warnings } = await resolveInitialProfile(args.profile, {
		agentDir,
		cwd: process.cwd(),
		trustOverride: args.trustOverride,
	});
	for (const warning of warnings) {
		console.error(`pi-profile: warning: ${warning}`);
	}
	// Stale per-launch instance dirs (dead pid, or no pid past the grace
	// window) are swept before this launch materializes its own. Directories
	// holding state pi-profile did not generate are kept and reported instead of
	// deleted (ADR-0010). Best-effort: sweep errors never block the launch.
	for (const warning of await sweepStaleInstances()) {
		console.error(`pi-profile: warning: ${warning}`);
	}
	const generated = await generateRuntimeDir(plan, { agentDir, discovery, projectSettings, projectDir });
	process.exitCode = await spawnPi({
		generated,
		piArgs: args.piArgs,
		// Only the default profile keeps trust behavior native (flag re-applied);
		// named profiles never forward it — the resolver is the trust gatekeeper.
		trustOverride: plan.filter === "none" ? args.trustOverride : undefined,
	});
} catch (error) {
	// Launcher input/selection failures (unknown profile, unresolvable
	// references, missing adapter, malformed catalogs) are usage errors:
	// exit 2. Unexpected failures: exit 1.
	const isUsageError =
		error instanceof UnknownProfileError ||
		error instanceof ActivationError ||
		error instanceof ExtensionError ||
		error instanceof MissingMcpAdapterError ||
		error instanceof McpConfigError ||
		error instanceof CatalogError;
	console.error(error instanceof Error ? `pi-profile: ${error.message}` : error);
	process.exitCode = isUsageError ? 2 : 1;
}
