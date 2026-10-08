import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LAUNCHER_BIN as BIN, launcherEnv, runLauncherRpc } from "./helpers/launcher-runner.ts";
import { addGlobalExtension, addGlobalSkill, createPiFixture, soleInstanceDir, type PiFixture } from "./helpers/pi-fixture.ts";
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

async function addProjectSkill(name: string): Promise<void> {
	const dir = path.join(fixture.cwd, ".pi", "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: project skill ${name}\n---\n`);
}

async function trustProject(): Promise<void> {
	await writeFile(path.join(fixture.agentDir, "trust.json"), JSON.stringify({ [fixture.cwd]: true }));
}

async function writeMcpConfig(servers: Record<string, unknown>): Promise<void> {
	await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: servers }));
}

interface RpcState {
	sessionId: string;
	sessionFile?: string;
	messageCount: number;
}

async function getState(rpc: RpcDriver): Promise<RpcState> {
	const response = await rpc.send({ type: "get_state" });
	return response.data as unknown as RpcState;
}

async function skillCommands(rpc: RpcDriver): Promise<Array<{ name: string; description?: string }>> {
	const response = await rpc.send({ type: "get_commands" });
	const commands = (response.data?.commands ?? []) as Array<{ name: string; description?: string }>;
	return commands.filter((command) => command.name.startsWith("skill:"));
}

describe("launcher integration: in-session switching", () => {
	it(
		"project-level visibility is the same before and after switching to default",
		{ timeout: 60_000 },
		async () => {
			await addProjectSkill("proj-skill");
			await addProjectSkill("proj-unselected");
			await writeCatalog({ doc: { skills: [] } });
			await trustProject();

			const rpc = new RpcDriver("node", [BIN, "doc", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const before = await getState(rpc);
				expect((await skillCommands(rpc)).map((command) => command.name).sort()).toEqual([
					"skill:proj-skill",
					"skill:proj-unselected",
				]);

				const switched = await rpc.send({ type: "prompt", message: "/profile use default" }, 60_000);
				expect(switched.success).toBe(true);

				const after = await getState(rpc);
				expect(after.sessionId).toBe(before.sessionId);
				expect((await skillCommands(rpc)).map((command) => command.name).sort()).toEqual([
					"skill:profile-config",
					"skill:proj-skill",
					"skill:proj-unselected",
				]);
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"/profile use switches without restarting: same session, new resources, state persisted",
		{ timeout: 60_000 },
		async () => {
			await addGlobalSkill(fixture, "alpha-skill");
			await addGlobalSkill(fixture, "beta-skill");
			await writeCatalog({
				alpha: { skills: ["alpha-skill"] },
				beta: { skills: ["beta-skill"] },
			});

			const rpc = new RpcDriver("node", [BIN, "alpha", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const before = await getState(rpc);
				expect((await skillCommands(rpc)).map((command) => command.name)).toEqual(["skill:alpha-skill"]);

				const switched = await rpc.send({ type: "prompt", message: "/profile use beta" }, 60_000);
				expect(switched.success).toBe(true);

				const after = await getState(rpc);
				expect(after.sessionId).toBe(before.sessionId);
				expect(after.sessionFile).toBe(before.sessionFile);
				expect(before.sessionFile).toBeDefined();
				expect(path.basename(path.dirname(before.sessionFile!))).toMatch(/^--.+--$/);
				expect(after.messageCount).toBe(before.messageCount);
				expect((await skillCommands(rpc)).map((command) => command.name)).toEqual(["skill:beta-skill"]);

				const state = JSON.parse(
					await readFile(path.join(fixture.agentDir, "pi-profile-state.json"), "utf8"),
				);
				expect(state).toEqual({ activeProfile: "beta" });
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"/profile reload picks up shared-resource edits without a restart",
		{ timeout: 60_000 },
		async () => {
			await addGlobalSkill(fixture, "alpha-skill");
			await writeCatalog({ alpha: { skills: ["alpha-skill"] } });

			const rpc = new RpcDriver("node", [BIN, "alpha", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				expect((await skillCommands(rpc))[0]?.description).toContain("alpha-skill");

				const skillFile = path.join(fixture.agentDir, "skills", "alpha-skill", "SKILL.md");
				await writeFile(
					skillFile,
					"---\nname: alpha-skill\ndescription: EDITED description\n---\nbody\n",
				);

				const reloaded = await rpc.send({ type: "prompt", message: "/profile reload" }, 60_000);
				expect(reloaded.success).toBe(true);

				expect((await skillCommands(rpc))[0]?.description).toBe("EDITED description");
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"a failed switch leaves the runtime and state untouched",
		{ timeout: 60_000 },
		async () => {
			await addGlobalSkill(fixture, "alpha-skill");
			await writeCatalog({ alpha: { skills: ["alpha-skill"] } });

			const rpc = new RpcDriver("node", [BIN, "alpha", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const failed = await rpc.send({ type: "prompt", message: "/profile use ghost" }, 60_000);
				expect(failed.success).toBe(true);

				expect((await skillCommands(rpc)).map((command) => command.name)).toEqual(["skill:alpha-skill"]);
				const { existsSync } = await import("node:fs");
				expect(existsSync(path.join(fixture.agentDir, "pi-profile-state.json"))).toBe(false);
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"profile switch changes per-server MCP tool policy",
		{ timeout: 60_000 },
		async () => {
			await writeFile(
				path.join(fixture.agentDir, "mcp.json"),
				JSON.stringify({ mcpServers: { github: { url: "https://gh" } } }),
			);
			await writeCatalog({
				broad: {},
				narrow: { mcp_tools: { github: ["search"] } },
			});

			const rpc = new RpcDriver("node", [BIN, "broad", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const before = await getState(rpc);
				const instance = await soleInstanceDir(fixture);
				let instanceMcp = JSON.parse(await readFile(path.join(instance, "mcp.json"), "utf8"));
				expect(instanceMcp.mcpServers.github.toolExposure).toBeUndefined();

				const switched = await rpc.send({ type: "prompt", message: "/profile use narrow" }, 60_000);
				expect(switched.success).toBe(true);

				const after = await getState(rpc);
				expect(after.sessionId).toBe(before.sessionId);

				instanceMcp = JSON.parse(await readFile(path.join(instance, "mcp.json"), "utf8"));
				expect(instanceMcp.mcpServers.github.toolExposure).toEqual({ "*": "hidden", search: "direct" });
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"empty MCP list survives reload",
		{ timeout: 60_000 },
		async () => {
			await writeFile(
				path.join(fixture.agentDir, "mcp.json"),
				JSON.stringify({ mcpServers: { github: { url: "https://gh" } } }),
			);
			await writeCatalog({
				denied: { mcp_tools: { github: [] } },
			});

			const rpc = new RpcDriver("node", [BIN, "denied", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const before = await getState(rpc);
				const instance = await soleInstanceDir(fixture);
				let instanceMcp = JSON.parse(await readFile(path.join(instance, "mcp.json"), "utf8"));
				expect(instanceMcp.mcpServers.github.toolExposure).toEqual({ "*": "hidden" });

				const reloaded = await rpc.send({ type: "prompt", message: "/profile reload" }, 60_000);
				expect(reloaded.success).toBe(true);

				const after = await getState(rpc);
				expect(after.sessionId).toBe(before.sessionId);

				instanceMcp = JSON.parse(await readFile(path.join(instance, "mcp.json"), "utf8"));
				expect(instanceMcp.mcpServers.github.toolExposure).toEqual({ "*": "hidden" });
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"failed switch restores previous MCP tool policy",
		{ timeout: 60_000 },
		async () => {
			await writeFile(
				path.join(fixture.agentDir, "mcp.json"),
				JSON.stringify({ mcpServers: { github: { url: "https://gh" } } }),
			);
			await writeCatalog({
				initial: { mcp_tools: { github: ["search"] } },
				failing: { mcp_tools: { unknown_srv: ["search"] } },
			});

			const rpc = new RpcDriver("node", [BIN, "initial", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				await getState(rpc);
				const instance = await soleInstanceDir(fixture);
				let instanceMcp = JSON.parse(await readFile(path.join(instance, "mcp.json"), "utf8"));
				expect(instanceMcp.mcpServers.github.toolExposure).toEqual({ "*": "hidden", search: "direct" });

				const failed = await rpc.send({ type: "prompt", message: "/profile use failing" }, 60_000);
				expect(failed.success).toBe(true);

				instanceMcp = JSON.parse(await readFile(path.join(instance, "mcp.json"), "utf8"));
				expect(instanceMcp.mcpServers.github.toolExposure).toEqual({ "*": "hidden", search: "direct" });
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"switching to an empty mcps selection disables discovered user-level servers",
		{ timeout: 60_000 },
		async () => {
			await mkdir(path.join(fixture.root, ".agents"), { recursive: true });
			await writeFile(
				path.join(fixture.root, ".agents", "mcp.json"),
				JSON.stringify({ mcpServers: { github: { url: "https://gh" } } }),
			);
			await writeMcpConfig({});
			await writeCatalog({
				open: {},
				closed: { mcps: [] },
			});

			const rpc = new RpcDriver("node", [BIN, "open", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				await getState(rpc);
				const instance = await soleInstanceDir(fixture);
				expect((await lstat(path.join(instance, "mcp.json"))).isSymbolicLink()).toBe(false);

				const switched = await rpc.send({ type: "prompt", message: "/profile use closed" }, 60_000);
				expect(switched.success).toBe(true);

				const instanceMcp = JSON.parse(await readFile(path.join(instance, "mcp.json"), "utf8"));
				expect(instanceMcp.mcpServers.github).toEqual({ url: "https://gh", enabled: false });
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"empty mcps selection survives reload",
		{ timeout: 60_000 },
		async () => {
			await mkdir(path.join(fixture.root, ".agents"), { recursive: true });
			await writeFile(
				path.join(fixture.root, ".agents", "mcp.json"),
				JSON.stringify({ mcpServers: { github: { url: "https://gh" } } }),
			);
			await writeMcpConfig({});
			await writeCatalog({
				closed: { mcps: [] },
			});

			const rpc = new RpcDriver("node", [BIN, "closed", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const before = await getState(rpc);
				const instance = await soleInstanceDir(fixture);
				let instanceMcp = JSON.parse(await readFile(path.join(instance, "mcp.json"), "utf8"));
				expect(instanceMcp.mcpServers.github).toEqual({ url: "https://gh", enabled: false });

				const reloaded = await rpc.send({ type: "prompt", message: "/profile reload" }, 60_000);
				expect(reloaded.success).toBe(true);

				const after = await getState(rpc);
				expect(after.sessionId).toBe(before.sessionId);

				instanceMcp = JSON.parse(await readFile(path.join(instance, "mcp.json"), "utf8"));
				expect(instanceMcp.mcpServers.github).toEqual({ url: "https://gh", enabled: false });
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"switching back to omitted mcps selection restores server availability",
		{ timeout: 60_000 },
		async () => {
			const originalMcp = JSON.stringify({ mcpServers: {} });
			await mkdir(path.join(fixture.root, ".agents"), { recursive: true });
			await writeFile(
				path.join(fixture.root, ".agents", "mcp.json"),
				JSON.stringify({ mcpServers: { github: { url: "https://gh" } } }),
			);
			await writeMcpConfig({});
			await writeCatalog({
				open: {},
				closed: { mcps: [] },
			});

			const rpc = new RpcDriver("node", [BIN, "closed", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				await getState(rpc);
				const instance = await soleInstanceDir(fixture);
				let instanceMcp = JSON.parse(await readFile(path.join(instance, "mcp.json"), "utf8"));
				expect(instanceMcp.mcpServers.github).toEqual({ url: "https://gh", enabled: false });

				const switched = await rpc.send({ type: "prompt", message: "/profile use open" }, 60_000);
				expect(switched.success).toBe(true);

				instanceMcp = JSON.parse(await readFile(path.join(instance, "mcp.json"), "utf8"));
				expect(instanceMcp.mcpServers.github).toEqual({ url: "https://gh" });
				expect(await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8")).toBe(originalMcp);
			} finally {
				await rpc.close();
			}
		},
	);
});

describe("in-session sparse resource selection (fix-undeclared-resource-filtering)", () => {
	async function extensionCommandNames(rpc: RpcDriver): Promise<string[]> {
		const response = await rpc.send({ type: "get_commands" });
		const commands = (response.data?.commands ?? []) as Array<{ name: string; source?: string }>;
		return commands.filter((command) => command.source === "extension").map((command) => command.name).sort();
	}

	it(
		"switching from declared kinds to a profile omitting them restores native visibility without a restart",
		{ timeout: 60_000 },
		async () => {
			await addGlobalSkill(fixture, "alpha-skill");
			await addGlobalSkill(fixture, "beta-skill");
			await addGlobalExtension(fixture, "ext-a");
			await addGlobalExtension(fixture, "ext-b");
			await writeCatalog({
				declared: { skills: ["alpha-skill"], extensions: ["ext-a"] },
				open: {},
			});

			const rpc = runLauncherRpc(fixture, ["declared", "--", "--mode", "rpc"]);
			try {
				const before = await getState(rpc);
				const skillsBefore = (await skillCommands(rpc)).map((command) => command.name);
				expect(skillsBefore).toEqual(["skill:alpha-skill"]);
				expect(await extensionCommandNames(rpc)).toContain("ext-a");
				expect(await extensionCommandNames(rpc)).not.toContain("ext-b");

				const switched = await rpc.send({ type: "prompt", message: "/profile use open" }, 60_000);
				expect(switched.success).toBe(true);

				const after = await getState(rpc);
				// Session identity and message history are retained, not just the file.
				expect(after.sessionId).toBe(before.sessionId);
				expect(after.sessionFile).toBe(before.sessionFile);
				expect(after.messageCount).toBe(before.messageCount);
				const skills = (await skillCommands(rpc)).map((command) => command.name);
				expect(skills).toContain("skill:alpha-skill");
				expect(skills).toContain("skill:beta-skill");
				expect(await extensionCommandNames(rpc)).toContain("ext-b");
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"reload after deleting each resource field restores that kind's native visibility",
		{ timeout: 60_000 },
		async () => {
			await addGlobalSkill(fixture, "alpha-skill");
			await addGlobalSkill(fixture, "beta-skill");
			await addGlobalExtension(fixture, "ext-a");
			await addGlobalExtension(fixture, "ext-b");
			await writeCatalog({ impl: { skills: ["beta-skill"], extensions: ["ext-a"] } });

			const rpc = runLauncherRpc(fixture, ["impl", "--", "--mode", "rpc"]);
			try {
				const before = await getState(rpc);
				expect((await skillCommands(rpc)).map((command) => command.name)).toEqual(["skill:beta-skill"]);
				expect(await extensionCommandNames(rpc)).toContain("ext-a");
				expect(await extensionCommandNames(rpc)).not.toContain("ext-b");

				await writeCatalog({ impl: {} });
				const reloaded = await rpc.send({ type: "prompt", message: "/profile reload" }, 60_000);
				expect(reloaded.success).toBe(true);

				const after = await getState(rpc);
				expect(after.sessionId).toBe(before.sessionId);
				expect(after.messageCount).toBe(before.messageCount);
				const skills = (await skillCommands(rpc)).map((command) => command.name);
				expect(skills).toContain("skill:alpha-skill");
				expect(skills).toContain("skill:beta-skill");
				expect(await extensionCommandNames(rpc)).toContain("ext-a");
				expect(await extensionCommandNames(rpc)).toContain("ext-b");
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"reload reflects real user settings edits for an omitted kind",
		{ timeout: 60_000 },
		async () => {
			await addGlobalSkill(fixture, "alpha-skill");
			await addGlobalSkill(fixture, "beta-skill");
			await writeCatalog({ open: {} });

			const rpc = runLauncherRpc(fixture, ["open", "--", "--mode", "rpc"]);
			try {
				const skillsBefore = (await skillCommands(rpc)).map((command) => command.name);
				expect(skillsBefore).toContain("skill:alpha-skill");

				await writeFile(
					path.join(fixture.agentDir, "settings.json"),
					JSON.stringify({ skills: ["-skills/alpha-skill/SKILL.md"] }),
				);
				const reloaded = await rpc.send({ type: "prompt", message: "/profile reload" }, 60_000);
				expect(reloaded.success).toBe(true);

				const skillsAfter = (await skillCommands(rpc)).map((command) => command.name);
				expect(skillsAfter).toContain("skill:beta-skill");
				expect(skillsAfter).not.toContain("skill:alpha-skill");
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"an injected write failure restores the exact prior runtime content and resource visibility",
		{ timeout: 60_000 },
		async () => {
			await addGlobalSkill(fixture, "alpha-skill");
			await addGlobalSkill(fixture, "beta-skill");
			await addGlobalExtension(fixture, "ext-a");
			await addGlobalExtension(fixture, "ext-b");
			await writeCatalog({
				declared: { skills: ["alpha-skill"], extensions: ["ext-a"] },
				open: {},
			});

			const rpc = runLauncherRpc(fixture, ["declared", "--", "--mode", "rpc"]);
			try {
				const before = await getState(rpc);
				const skillsBefore = (await skillCommands(rpc)).map((command) => command.name);
				const extensionsBefore = await extensionCommandNames(rpc);
				expect(skillsBefore).toEqual(["skill:alpha-skill"]);
				expect(extensionsBefore).not.toContain("ext-b");

				const instance = await soleInstanceDir(fixture);
				const settingsPath = path.join(instance, "settings.json");
				const planPath = path.join(instance, "pi-profile.json");
				const settingsBefore = await readFile(settingsPath, "utf8");
				const planBefore = await readFile(planPath, "utf8");

				// The switch writes settings.json first, then pi-profile.json. A
				// read-only plan file makes the plan write fail after settings.json
				// changed, exercising the process-level rollback boundary.
				await chmod(planPath, 0o444);
				const attempted = await rpc.send({ type: "prompt", message: "/profile use open" }, 60_000);
				expect(attempted.success).toBe(true);

				// Exact prior runtime content; the failed target is not active.
				expect(await readFile(settingsPath, "utf8")).toBe(settingsBefore);
				expect(await readFile(planPath, "utf8")).toBe(planBefore);
				expect(JSON.parse(await readFile(planPath, "utf8")).profile).toBe("declared");

				// Actual resource visibility after the real process reload: the
				// failed target's extra resources are not visible and the declared
				// restriction still applies.
				const after = await getState(rpc);
				expect(after.sessionId).toBe(before.sessionId);
				expect((await skillCommands(rpc)).map((command) => command.name)).toEqual(skillsBefore);
				expect(await extensionCommandNames(rpc)).toEqual(extensionsBefore);
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"transitions the extension mirror in both directions with session identity retained",
		{ timeout: 60_000 },
		async () => {
			await addGlobalExtension(fixture, "ext-a");
			await addGlobalExtension(fixture, "ext-b");
			await writeCatalog({ declared: { extensions: ["ext-a"] }, open: {} });

			const rpc = runLauncherRpc(fixture, ["open", "--", "--mode", "rpc"]);
			try {
				const before = await getState(rpc);
				const instance = await soleInstanceDir(fixture);
				const link = path.join(instance, "extensions");
				expect((await lstat(link)).isSymbolicLink()).toBe(true);
				expect(await extensionCommandNames(rpc)).toContain("ext-b");

				// Omitted -> declared: the generated link is removed and only the
				// declared extension stays visible.
				const switched = await rpc.send({ type: "prompt", message: "/profile use declared" }, 60_000);
				expect(switched.success).toBe(true);
				await expect(lstat(link)).rejects.toMatchObject({ code: "ENOENT" });
				expect(await extensionCommandNames(rpc)).toContain("ext-a");
				expect(await extensionCommandNames(rpc)).not.toContain("ext-b");

				// Declared -> omitted: the link is restored and native visibility
				// returns without restarting.
				const back = await rpc.send({ type: "prompt", message: "/profile use open" }, 60_000);
				expect(back.success).toBe(true);
				expect((await lstat(link)).isSymbolicLink()).toBe(true);
				const after = await getState(rpc);
				expect(after.sessionId).toBe(before.sessionId);
				expect(after.messageCount).toBe(before.messageCount);
				expect(await extensionCommandNames(rpc)).toContain("ext-b");
			} finally {
				await rpc.close();
			}
		},
	);

	it(
		"an unsafe real directory at the instance extension path blocks the transition safely",
		{ timeout: 60_000 },
		async () => {
			await addGlobalExtension(fixture, "ext-a");
			await addGlobalExtension(fixture, "ext-b");
			await writeCatalog({ declared: { extensions: ["ext-a"] }, open: {} });

			const rpc = runLauncherRpc(fixture, ["declared", "--", "--mode", "rpc"]);
			try {
				await rpc.send({ type: "get_state" });
				const instance = await soleInstanceDir(fixture);
				const link = path.join(instance, "extensions");
				await expect(lstat(link)).rejects.toMatchObject({ code: "ENOENT" });
				// Real content appears at the managed path (created by Pi or a user).
				await mkdir(link, { recursive: true });
				await writeFile(path.join(link, "real.ts"), "real bytes");

				const attempted = await rpc.send({ type: "prompt", message: "/profile use open" }, 60_000);
				expect(attempted.success).toBe(true);

				// The failure is actionable and never deletes the real content; the prior
				// representation, visibility, and selection stay intact. Actionability of
				// the error itself is asserted at the switch boundary in
				// test/switch-profile.test.ts (the post-reload notify is swallowed once
				// the reload invalidates this extension context).
				expect(await readFile(path.join(link, "real.ts"), "utf8")).toBe("real bytes");
				expect(JSON.parse(await readFile(path.join(instance, "pi-profile.json"), "utf8")).profile).toBe("declared");
				expect(await extensionCommandNames(rpc)).toContain("ext-a");
				expect(await extensionCommandNames(rpc)).not.toContain("ext-b");
				// The failed selection is not persisted.
				await expect(
					readFile(path.join(fixture.agentDir, "pi-profile-state.json"), "utf8"),
				).rejects.toThrow();
			} finally {
				await rpc.close();
			}
		},
	);
});
