import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import path from "node:path";

import { readTrustInputs } from "../../src/launcher/initial-profile.ts";
import { discoverAdapterServerNames } from "../../src/mcp-config.ts";
import { RuntimeStateStore } from "../../src/runtime-state-store.ts";
import { applyLaunchPlan, readLaunchPlanFile } from "../../src/switching/apply-plan.ts";
import { OVERLAY_USAGE, applyOverlayMutation, clearOverlay, parseOverlayArgs } from "../../src/switching/overlay.ts";
import { formatProfileList, listProfiles } from "../../src/switching/list-profiles.ts";
import { buildStatusReport, formatStatusMarkdown } from "../../src/switching/status.ts";
import { switchProfile, type SwitchDeps } from "../../src/switching/switch-profile.ts";
import { getGlobalStateDir } from "../../src/workspace.ts";

/**
 * pi-profile extension entry.
 *
 * Loaded into the spawned pi via `-e`. Responsibilities:
 * - After every session start (startup/reload/new/resume/fork), apply the
 *   launch plan: re-expand tool references against Pi's live registry
 *   (including extension- and MCP-provided tools) and call setActiveTools
 *   for strict allowlisting, persist the selection after switches, and
 *   produce the one-shot change summary injected into the next turn
 *   via `before_agent_start`.
 * - `/profile use <name>` / `/profile reload`: in-session switching without
 *   restarting the Pi process (src/switching/switch-profile.ts).
 * - `/profile overlay ...`: runtime overlay (ticket 06; renamed with the
 *   command word — disable/enable/tools/clear).
 * - `/profile` (selector; degrades to the list without dialog-capable UI)
 *   and `/profile status`: observability surface (ticket 07). Status
 *   combines the active launch plan, the stored overlay, fresh MCP
 *   discovery, and Pi's actual command registrations (the winner evidence
 *   for same-name conflicts).
 * - The degraded list and status ship structured `details` payloads
 *   (`{kind, profiles}` / `{kind, report}`) for RPC consumers (ticket 11).
 *
 * Pi re-executes this module on reload, so post-reload state is established
 * exclusively through `session_start` — nothing stale survives.
 */

function setProfileStatus(ui: unknown, profile: string | undefined): void {
	if (profile && typeof (ui as { setStatus?: (k: string, v: string) => void })?.setStatus === "function") {
		(ui as { setStatus: (k: string, v: string) => void }).setStatus("profile", `profile: ${profile}`);
	}
}

export default function piProfileExtension(pi: ExtensionAPI): void {
	const runtimeDir = process.env.PI_CODING_AGENT_DIR;
	if (runtimeDir === undefined) return;

	let pendingSummary: string | undefined;

	pi.on("session_start", async (event, ctx) => {
		const plan = await readLaunchPlanFile(runtimeDir);
		setProfileStatus(ctx.ui, plan?.profile);
		const result = await applyLaunchPlan({
			runtimeDir,
			cwd: ctx.cwd,
			reason: event.reason,
			surface: {
				getAllTools: () => pi.getAllTools(),
				setActiveTools: (names) => pi.setActiveTools(names),
				notify: (message, level) => ctx.ui?.notify(message, level),
			},
		});
		pendingSummary = result.summary;
	});

	pi.on("before_agent_start", async (event) => {
		let systemPrompt = event.systemPrompt;
		if (pendingSummary !== undefined) {
			systemPrompt = `${systemPrompt}\n\n[${pendingSummary}]`;
			pendingSummary = undefined;
		}
		return { systemPrompt };
	});

	pi.registerCommand("profile", {
		description: "pi-profile: /profile [use|reload|status|overlay]",
		handler: async (args, ctx) => {
			const [subcommandRaw, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const subcommand = subcommandRaw ?? ""; // bare /profile → selector
			// Stale-tolerant: after a successful reload this command context is
			// invalidated and property access throws. Post-reload feedback is
			// the new instance's job (session_start summary), so swallowed
			// stale-ctx failures lose nothing the user would otherwise see.
			const notify = (message: string, level: "info" | "warning" | "error") => {
				try {
					ctx.ui?.notify(message, level);
				} catch {
					// stale context after reload — see above
				}
			};
			const usage = `usage: /profile [use <name> | reload | status | ${OVERLAY_USAGE}]`;
			if (subcommand === "use" && rest.length === 0) {
				notify("usage: /profile use <name>", "error");
				return;
			}
			if (subcommand !== "" && !["use", "reload", "status", "overlay"].includes(subcommand)) {
				notify(usage, "error");
				return;
			}
			try {
				const plan = await readLaunchPlanFile(runtimeDir);
				if (plan?.agentDir === undefined) {
					// Without the real agent dir the switch cannot reach catalogs,
					// trust state, or state files — fail loudly, never guess one.
					notify("cannot switch: the launch plan carries no real agent dir", "error");
					return;
				}
				const deps: SwitchDeps = {
					runtimeDir,
					realAgentDir: plan.agentDir,
					cwd: ctx.cwd,
					waitForIdle: () => ctx.waitForIdle(),
					reload: () => ctx.reload(),
					// A real reload invalidates this context (Pi re-executes
					// extensions); property access then throws. Interactive Pi
					// swallows reload refusals, so this probe is the switch's
					// proof that the reload actually ran.
					assertStale: () => {
						void ctx.cwd;
					},
				};
				if (subcommand === "use") {
					const result = await switchProfile(rest[0], deps, { clearOverlay: true });
					for (const warning of result.warnings) notify(warning, "warning");
					setProfileStatus(ctx.ui, result.profile);
					notify(`profile active: ${result.profile}`, "info");
					return;
				}
				if (subcommand === "reload") {
					const result = await switchProfile(undefined, deps, { reloadCurrent: true });
					for (const warning of result.warnings) notify(warning, "warning");
					setProfileStatus(ctx.ui, result.profile);
					notify(`profile reloaded: ${result.profile}`, "info");
					return;
				}
				if (subcommand === "overlay") {
					const command = parseOverlayArgs(rest.join(" "));
					if (command.kind === "clear") {
						const result = await clearOverlay(deps);
						for (const warning of result.warnings) notify(warning, "warning");
						notify(`overlay cleared: ${result.profile}`, "info");
						return;
					}
					const result = await applyOverlayMutation(deps, command.mutate);
					for (const warning of result.warnings) notify(warning, "warning");
					notify(`overlay updated: ${result.profile}`, "info");
					return;
				}
				// Observability surface (ticket 07): bare /profile opens the
				// selector; status renders via a displayed custom message.
				const entries = await listProfiles({ realAgentDir: plan.agentDir, cwd: ctx.cwd });
				if (subcommand === "status") {
					const { projectTrusted } = await readTrustInputs({ agentDir: plan.agentDir, cwd: ctx.cwd });
					const stateDir = plan.source === "project" ? path.join(ctx.cwd, ".pi") : getGlobalStateDir(plan.agentDir);
					const state = await new RuntimeStateStore(stateDir).read();
					const report = buildStatusReport({
						plan,
						overlay: state.overlay,
						discoveredMcpServers: await discoverAdapterServerNames(
							plan.agentDir,
							projectTrusted ? ctx.cwd : undefined,
						),
						commands: pi.getCommands(),
						tools: pi.getAllTools(),
					});
					pi.sendMessage({
						customType: "pi-profile",
						content: formatStatusMarkdown(report),
						display: true,
						// Structured form for RPC consumers (ticket 11): the message
						// event carries the full report object in `details`.
						details: { kind: "status", report },
					});
					return;
				}
				// Bare /profile: the interactive selector. Degradation boundary
				// (delta "Observability surface"): outside TUI mode the selector
				// does not run — the bare invocation degrades to the trust-gated
				// list, carrying the structured payload the removed `list`
				// subcommand emitted.
				if (!ctx.hasUI || ctx.mode !== "tui") {
					pi.sendMessage({
						customType: "pi-profile",
						content: formatProfileList(entries, plan.profile),
						display: true,
						details: { kind: "list", profiles: entries },
					});
					return;
				}
				const choice = await ctx.ui.select(
					"select a profile",
						entries.map((entry) => {
						const label = entry.label ?? entry.description;
						return `${entry.name} [${entry.source}]${label !== undefined ? ` — ${label}` : ""}`;
					}),
				);
				if (choice === undefined) return; // cancelled
				const chosen = choice.split(" [")[0] ?? choice;
				if (chosen === plan.profile) return;
				const switched = await switchProfile(chosen, deps, { clearOverlay: true });
				for (const warning of switched.warnings) notify(warning, "warning");
				setProfileStatus(ctx.ui, switched.profile);
			} catch (error) {
				notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
