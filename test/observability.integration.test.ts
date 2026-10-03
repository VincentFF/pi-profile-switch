import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RpcDriver } from "./helpers/rpc-driver.ts";
import { addGlobalSkill, createPiFixture, type PiFixture } from "./helpers/pi-fixture.ts";

let fixture: PiFixture;
let driver: RpcDriver;

beforeEach(async () => {
	fixture = await createPiFixture();
	await addGlobalSkill(fixture, "review");
	await addGlobalSkill(fixture, "impl");
	const globalProfilesDir = path.join(fixture.profileSwitchDir, "profiles");
	await mkdir(globalProfilesDir, { recursive: true });
	await writeFile(path.join(globalProfilesDir, "review.json"), JSON.stringify({ skills: ["review"] }));
	await writeFile(path.join(globalProfilesDir, "impl.json"), JSON.stringify({ skills: ["impl"] }));
	await writeFile(path.join(globalProfilesDir, "shared.json"), JSON.stringify({}));

	const projectProfilesDir = path.join(fixture.cwd, ".pi", "profiles");
	await mkdir(projectProfilesDir, { recursive: true });
	await writeFile(path.join(projectProfilesDir, "shared.json"), JSON.stringify({ label: "project shared" }));
	// An enabled server and a snapshot-disabled server are both discovered; without
	// an explicit mcps whitelist, status must not present the disabled server as enabled.
	await writeFile(
		path.join(fixture.agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { github: {}, linear: { enabled: false } } }),
	);
});

afterEach(async () => {
	await driver?.close();
	await rm(fixture.root, { recursive: true, force: true });
});

async function start(profile = "review"): Promise<void> {
	// Pre-seed trust so the project catalog participates.
	await writeFile(path.join(fixture.agentDir, "trust.json"), JSON.stringify({ [fixture.cwd]: true }));
	driver = new RpcDriver("node", [path.resolve("bin/pi-profile.ts"), profile, "--", "--mode", "rpc"], {
		cwd: fixture.cwd,
		env: {
			...process.env,
			HOME: fixture.root,
			PI_CODING_AGENT_DIR: fixture.agentDir,
			PI_OFFLINE: "1",
		},
	});
	await driver.send({ type: "get_state" });
}

async function command(text: string, timeoutMs = 60_000): Promise<void> {
	await driver.send({ type: "prompt", message: `/${text}` }, timeoutMs);
}

async function messageContaining(fragment: string): Promise<unknown> {
	return driver.waitFor((message) => JSON.stringify(message).includes(fragment));
}

describe("observability surface against a real spawned pi", () => {
	it("bare /profile degrades to the list with sources, project shadowing, and the structured payload", async () => {
		await start();

		await command("profile");

		await messageContaining("shared [project] (shadows global)");
		const seen = driver.messages.map((message) => JSON.stringify(message)).join("\n");
		expect(seen).toContain("default [builtin]");
		expect(seen).toContain("review [global]");
		expect(seen).toContain("shared [project] (shadows global) — project shared");
		// RPC-consumable structured form: the degraded list carries the same
		// {kind, profiles} payload the removed `list` subcommand emitted.
		const structured = driver.messages.find(
			(message) =>
				typeof message === "object" &&
				message !== null &&
				JSON.stringify(message).includes('"kind":"list"') &&
				JSON.stringify(message).includes('"name":"review","source":"global"'),
		);
		expect(structured).toBeDefined();
	}, 90_000);

	it("/profile status shows resolved paths, mcp tri-state, and the switch delta", async () => {
		await start();

		await command("profile status");
		await messageContaining("mcp: enabled=[github]");
		let seen = driver.messages.map((message) => JSON.stringify(message)).join("\n");
		expect(seen).toContain(`review → ${path.join(fixture.agentDir, "skills", "review", "SKILL.md")}`);
		expect(seen).toContain("enabled=[github]");
		expect(seen).toContain("disabled=[linear]");
		expect(seen).toContain("github: unrestricted");
		expect(seen).not.toContain("linear: unrestricted");

		// RPC-consumable structured form (ticket 11): the custom message
		// carries the report object in details.
		const structured = driver.messages.find(
			(message) =>
				typeof message === "object" &&
				message !== null &&
				JSON.stringify(message).includes('"kind":"status"') &&
				JSON.stringify(message).includes('"profile":"review"'),
		);
		expect(structured).toBeDefined();

		// Switch (the prompt response returns after the handler's reload
		// settles), then status reflects the delta against the previous plan.
		await command("profile use impl");
		expect(await driver.skillCommandNames()).toEqual(["skill:impl"]);

		await command("profile status");
		await messageContaining("delta: +[skill:impl] -[skill:review]");
	}, 90_000);

	it("/profile status stays available when a user-level MCP source is malformed under no policy", async () => {
		await writeFile(
			path.join(fixture.agentDir, "mcp.json"),
			JSON.stringify({ mcpServers: { github: {} } }),
		);
		await mkdir(path.join(fixture.root, ".agents"), { recursive: true });
		const malformedPath = path.join(fixture.root, ".agents", "mcp.json");
		await writeFile(malformedPath, "{ invalid");
		await start("shared");

		await command("profile status");
		await messageContaining("mcp: enabled=[github]");

		const seen = driver.messages.map((message) => JSON.stringify(message)).join("\n");
		expect(seen).toContain(malformedPath);
		expect(seen).not.toContain('"success":false');
	}, 90_000);

	it("/profile status keeps project-owned servers enabled with an empty mcps selection", async () => {
		await writeFile(
			path.join(fixture.agentDir, "mcp.json"),
			JSON.stringify({ mcpServers: { github: {} } }),
		);
		await mkdir(path.join(fixture.cwd, ".pi"), { recursive: true });
		await writeFile(
			path.join(fixture.cwd, ".pi", "mcp.json"),
			JSON.stringify({ mcpServers: { proj: {} } }),
		);
		await writeFile(path.join(fixture.agentDir, "trust.json"), JSON.stringify({ [fixture.cwd]: true }));

		const globalProfilesDir = path.join(fixture.profileSwitchDir, "profiles");
		await mkdir(globalProfilesDir, { recursive: true });
		await writeFile(path.join(globalProfilesDir, "closed.json"), JSON.stringify({ mcps: [] }));

		driver = new RpcDriver("node", [path.resolve("bin/pi-profile.ts"), "closed", "--", "--mode", "rpc"], {
			cwd: fixture.cwd,
			env: {
				...process.env,
				HOME: fixture.root,
				PI_CODING_AGENT_DIR: fixture.agentDir,
				PI_OFFLINE: "1",
			},
		});
		await driver.send({ type: "get_state" });

		await command("profile status");
		await messageContaining("mcp: enabled=[proj]");
		const seen = driver.messages.map((message) => JSON.stringify(message)).join("\n");
		expect(seen).toContain("disabled=[github]");
		expect(seen).not.toContain("disabled=[proj]");
	}, 90_000);
});
