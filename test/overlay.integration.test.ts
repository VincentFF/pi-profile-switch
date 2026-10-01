import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LAUNCHER_BIN as BIN, launcherEnv } from "./helpers/launcher-runner.ts";
import { addGlobalSkill, createPiFixture, soleInstanceDir, type PiFixture } from "./helpers/pi-fixture.ts";
import { RpcDriver } from "./helpers/rpc-driver.ts";

let fixture: PiFixture;

beforeEach(async () => {
	fixture = await createPiFixture();
});

afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true });
});

async function writeCatalog(profiles: Record<string, unknown>): Promise<void> {
	const dir = path.join(fixture.profileSwitchDir, "profiles");
	await mkdir(dir, { recursive: true });
	for (const [name, definition] of Object.entries(profiles)) {
		await writeFile(path.join(dir, `${name}.json`), JSON.stringify(definition));
	}
}

async function skillNames(rpc: RpcDriver): Promise<string[]> {
	return (await rpc.skillCommandNames()).sort();
}

async function readState(): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(path.join(fixture.agentDir, "pi-profile-state.json"), "utf8"));
}

describe("launcher integration: runtime overlay", () => {
	it(
		"overlay narrows the runtime only: state holds the overlay, the catalog is untouched, the next launch ignores it",
		{ timeout: 90_000 },
		async () => {
			await addGlobalSkill(fixture, "alpha-skill");
			await addGlobalSkill(fixture, "beta-skill");
			await writeCatalog({ review: { skills: ["alpha-skill", "beta-skill"] } });

			const rpc = new RpcDriver("node", [BIN, "review", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				expect(await skillNames(rpc)).toEqual(["skill:alpha-skill", "skill:beta-skill"]);

				const narrowed = await rpc.send(
					{ type: "prompt", message: "/profile overlay disable skill beta-skill" },
					60_000,
				);
				expect(narrowed.success).toBe(true);
				expect(await skillNames(rpc)).toEqual(["skill:alpha-skill"]);

				// Overlay persisted to runtime state; the catalog file is untouched.
				expect((await readState()).overlay).toEqual({ disabledSkills: ["beta-skill"] });
				const profile = JSON.parse(
					await readFile(path.join(fixture.profileSwitchDir, "profiles", "review.json"), "utf8"),
				);
				expect(profile.skills).toEqual(["alpha-skill", "beta-skill"]);

				// overlay clear restores the declared set.
				const cleared = await rpc.send({ type: "prompt", message: "/profile overlay clear" }, 60_000);
				expect(cleared.success).toBe(true);
				expect(await skillNames(rpc)).toEqual(["skill:alpha-skill", "skill:beta-skill"]);
				expect((await readState()).overlay).toBeUndefined();
			} finally {
				await rpc.close();
			}

			// A fresh launch restores the profile WITHOUT the discarded overlay
			// (the launcher never reads stored overlays).
			const relaunched = new RpcDriver("node", [BIN, "review", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				expect(await skillNames(relaunched)).toEqual(["skill:alpha-skill", "skill:beta-skill"]);
			} finally {
				await relaunched.close();
			}
		},
	);

	it(
		"an overlay can disable a resolved extension",
		{ timeout: 60_000 },
		async () => {
			const extensionsDir = path.join(fixture.agentDir, "extensions");
			const extFile = path.join(extensionsDir, "my-ext.ts");
			await mkdir(extensionsDir, { recursive: true });
			await writeFile(
				extFile,
				[
					`import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";`,
					`export default function (pi: ExtensionAPI) {`,
					`\tpi.registerCommand("my-ext-cmd", { description: "from my-ext", handler: async () => {} });`,
					`}`,
					"",
				].join("\n"),
			);
			await writeCatalog({ review: { extensions: ["my-ext"] } });

			const rpc = new RpcDriver("node", [BIN, "review", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const commands = await rpc.commandNames();
				expect(commands.some((c) => c.name === "my-ext-cmd")).toBe(true);

				const disableAttempt = await rpc.send(
					{ type: "prompt", message: "/profile overlay disable extension my-ext" },
					60_000,
				);
				expect(disableAttempt.success).toBe(true);

				const state = (await readState()) as { overlay?: { disabledExtensions?: string[] } };
				expect(state.overlay?.disabledExtensions).toEqual(["my-ext"]);
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"a switch discards the previous profile's overlay",
		{ timeout: 60_000 },
		async () => {
			await addGlobalSkill(fixture, "alpha-skill");
			await addGlobalSkill(fixture, "beta-skill");
			await writeCatalog({
				review: { skills: ["alpha-skill", "beta-skill"] },
				impl: { skills: ["beta-skill"] },
			});

			const rpc = new RpcDriver("node", [BIN, "review", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				await rpc.send({ type: "prompt", message: "/profile overlay disable skill beta-skill" }, 60_000);
				expect((await readState()).overlay).toEqual({ disabledSkills: ["beta-skill"] });

				const switched = await rpc.send({ type: "prompt", message: "/profile use impl" }, 60_000);
				expect(switched.success).toBe(true);

				expect(await skillNames(rpc)).toEqual(["skill:beta-skill"]);
				const state = await readState();
				expect(state.activeProfile).toBe("impl");
				expect(state.overlay).toBeUndefined();
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"a stored glob disable is re-expanded on reload and narrows a newly resolved skill",
		{ timeout: 90_000 },
		async () => {
			await addGlobalSkill(fixture, "alpha-skill");
			await addGlobalSkill(fixture, "git-commit");
			await writeCatalog({ review: { skills: ["alpha-skill", "git-commit"] } });

			const rpc = new RpcDriver("node", [BIN, "review", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				expect(await skillNames(rpc)).toEqual(["skill:alpha-skill", "skill:git-commit"]);

				// The glob is stored as written and narrows its current matches.
				const disabled = await rpc.send(
					{ type: "prompt", message: "/profile overlay disable skill git-*" },
					60_000,
				);
				expect(disabled.success).toBe(true);
				expect(await skillNames(rpc)).toEqual(["skill:alpha-skill"]);
				expect((await readState()).overlay).toEqual({ disabledSkills: ["git-*"] });

				// Mid-runtime the profile resolves a NEW skill matching the stored
				// glob; reload re-expands the pattern and narrows it too.
				await addGlobalSkill(fixture, "git-rebase");
				await writeCatalog({ review: { skills: ["alpha-skill", "git-commit", "git-rebase"] } });

				const reloaded = await rpc.send({ type: "prompt", message: "/profile reload" }, 60_000);
				expect(reloaded.success).toBe(true);
				expect(await skillNames(rpc)).toEqual(["skill:alpha-skill"]);
				expect((await readState()).overlay).toEqual({ disabledSkills: ["git-*"] });
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"empty tools denies sibling extension tools and overlays still reapply",
		{ timeout: 120_000 },
		async () => {
			const extensionsDir = path.join(fixture.agentDir, "extensions");
			await mkdir(extensionsDir, { recursive: true });
			await writeFile(
				path.join(extensionsDir, "linter.ts"),
				`export default function (pi: any) {
					pi.registerTool({
						name: "lint_check",
						label: "Lint check",
						description: "Run fixture lint",
						parameters: { type: "object", properties: {} },
						execute: async () => ({ content: [{ type: "text", text: "lint" }] }),
					});
				}
				`,
			);
			const activeToolsPath = path.join(fixture.root, "active-tools.json");
			await writeFile(
				path.join(extensionsDir, "active-tool-probe.ts"),
				`import { writeFile } from "node:fs/promises";
					export default function (pi: any) {
						pi.on("session_start", async () => {
							await writeFile(${JSON.stringify(activeToolsPath)}, JSON.stringify(pi.getActiveTools()));
						});
					}
				`,
			);
			await writeCatalog({
				empty: { extensions: ["linter", "active-tool-probe"], tools: [] },
				lint: { extensions: ["linter", "active-tool-probe"], tools: ["lint_check"] },
			});

			const readActiveTools = async (): Promise<string[]> => {
				for (let attempt = 0; attempt < 40; attempt++) {
					try {
						return JSON.parse(await readFile(activeToolsPath, "utf8"));
					} catch {
						await new Promise((resolve) => setTimeout(resolve, 25));
					}
				}
				throw new Error("timed out waiting for active-tool probe");
			};
			const clearActiveTools = async () => rm(activeToolsPath, { force: true });

			const rpc = new RpcDriver("node", [BIN, "empty", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				await rpc.send({ type: "get_state" }).catch((error: unknown) => {
					throw new Error(`${error instanceof Error ? error.message : String(error)}\n${rpc.stderr.join("")}`);
				});
				const initialTools = await readActiveTools();
				expect(initialTools).not.toContain("lint_check");

				await clearActiveTools();
				const switched = await rpc.send({ type: "prompt", message: "/profile use lint" }, 60_000);
				expect(switched.success).toBe(true);
				const selectedTools = await readActiveTools();
				expect(selectedTools).toContain("lint_check");

				await clearActiveTools();
				const disabled = await rpc.send(
					{ type: "prompt", message: "/profile overlay disable tool lint_check" },
					60_000,
				);
				expect(disabled.success).toBe(true);
				expect(await readActiveTools()).not.toContain("lint_check");

				await clearActiveTools();
				const reloaded = await rpc.send({ type: "prompt", message: "/profile reload" }, 60_000);
				expect(reloaded.success).toBe(true);
				expect(await readActiveTools()).not.toContain("lint_check");

				await clearActiveTools();
				const enabled = await rpc.send(
					{ type: "prompt", message: "/profile overlay enable tool lint_check" },
					60_000,
				);
				expect(enabled.success).toBe(true);
				expect(await readActiveTools()).toContain("lint_check");
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"overlay disable tool narrows the active tool set and enable restores it",
		{ timeout: 90_000 },
		async () => {
			await writeCatalog({ review: { tools: ["read", "bash"] } });

			const rpc = new RpcDriver("node", [BIN, "review", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				// The launcher creates the instance dir as pi starts — resolve it
				// after the first round trip, not at spawn time.
				await rpc.send({ type: "get_state" });
				const instance = await soleInstanceDir(fixture);
				const settings = async () => JSON.parse(await readFile(path.join(instance, "settings.json"), "utf8"));
				const plan = async () => JSON.parse(await readFile(path.join(instance, "pi-profile.json"), "utf8"));

				expect((await settings()).defaultTools).toEqual(["read", "bash"]);

				const disabled = await rpc.send(
					{ type: "prompt", message: "/profile overlay disable tool bash" },
					60_000,
				);
				expect(disabled.success).toBe(true);
				expect((await readState()).overlay).toEqual({ disabledTools: ["bash"] });
				// The active tool set narrows: the boot baseline loses bash and the
				// plan carries the entry verbatim (declared refs stay untouched).
				expect((await settings()).defaultTools).toEqual(["read"]);
				expect((await plan()).disabledTools).toEqual(["bash"]);
				expect((await plan()).toolReferences).toEqual(["read", "bash"]);

				const enabled = await rpc.send(
					{ type: "prompt", message: "/profile overlay enable tool bash" },
					60_000,
				);
				expect(enabled.success).toBe(true);
				const afterEnable = (await readState()).overlay as Record<string, unknown> | undefined;
				expect(afterEnable === undefined || Object.keys(afterEnable).length === 0).toBe(true);
				expect((await settings()).defaultTools).toEqual(["read", "bash"]);
				expect((await plan()).disabledTools).toBeUndefined();
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"overlay forms execute normally in non-TUI (rpc) mode",
		{ timeout: 60_000 },
		async () => {
			await addGlobalSkill(fixture, "alpha-skill");
			await addGlobalSkill(fixture, "beta-skill");
			await writeCatalog({ review: { skills: ["alpha-skill", "beta-skill"] } });

			const rpc = new RpcDriver("node", [BIN, "review", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const disabled = await rpc.send(
					{ type: "prompt", message: "/profile overlay disable skill beta-skill" },
					60_000,
				);
				expect(disabled.success).toBe(true);
				expect(await skillNames(rpc)).toEqual(["skill:alpha-skill"]);

				// enable removes the stored entry by exact string match.
				const enabled = await rpc.send(
					{ type: "prompt", message: "/profile overlay enable skill beta-skill" },
					60_000,
				);
				expect(enabled.success).toBe(true);
				expect(await skillNames(rpc)).toEqual(["skill:alpha-skill", "skill:beta-skill"]);
				// The stored entry is gone: the overlay carries no disable entries
				// (an emptied overlay may persist as {}).
				const afterEnable = (await readState()).overlay as Record<string, unknown> | undefined;
				expect(afterEnable === undefined || Object.keys(afterEnable).length === 0).toBe(true);
			} finally {
				await rpc.close();
			}
		},
	);
});
