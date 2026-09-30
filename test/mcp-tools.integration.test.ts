import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runLauncher } from "./helpers/launcher-runner.ts";
import { createPiFixture, soleInstanceDir, type PiFixture } from "./helpers/pi-fixture.ts";

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

async function writeMcpConfig(servers: Record<string, unknown>): Promise<void> {
	await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: servers }));
}

describe("launcher integration: per-server MCP tool selection (native semantics)", () => {
	it("selector allowlist replaces exposure wholesale with direct/hidden", async () => {
		await writeMcpConfig({
			github: { url: "https://x", toolExposure: { delete: "hidden" } },
			linear: { command: "linear" },
		});
		await writeCatalog({
			review: { mcp_tools: { github: ["search", "delete"] } },
		});

		const res = await runLauncher(fixture, ["review", "--", "--mode", "rpc"]);
		expect(res.code).toBe(0);

		const instanceDir = await soleInstanceDir(fixture);
		const instanceMcp = JSON.parse(await readFile(path.join(instanceDir, "mcp.json"), "utf8"));
		expect(instanceMcp.mcpServers.github.toolExposure).toEqual({
			"*": "hidden",
			search: "direct",
			delete: "direct",
		});
		expect(instanceMcp.mcpServers.linear.toolExposure).toBeUndefined();
	}, 30_000);

	it("empty list denies all tools via hidden wildcard", async () => {
		await writeMcpConfig({ github: { url: "https://x" } });
		await writeCatalog({
			denyall: { mcp_tools: { github: [] } },
		});

		const res = await runLauncher(fixture, ["denyall", "--", "--mode", "rpc"]);
		expect(res.code).toBe(0);

		const instanceDir = await soleInstanceDir(fixture);
		const instanceMcp = JSON.parse(await readFile(path.join(instanceDir, "mcp.json"), "utf8"));
		expect(instanceMcp.mcpServers.github.toolExposure).toEqual({ "*": "hidden" });
	}, 30_000);

	it("prefixed adapter-era selector is encoded as-is and matches no tool", async () => {
		await writeMcpConfig({ fixture: { command: "node", args: ["--version"] } });
		await writeCatalog({
			prefixed: { mcp_tools: { fixture: ["fixture_search"] } },
		});

		const res = await runLauncher(fixture, ["prefixed", "--", "--mode", "rpc"]);
		expect(res.code).toBe(0);

		const instanceDir = await soleInstanceDir(fixture);
		const instanceMcp = JSON.parse(await readFile(path.join(instanceDir, "mcp.json"), "utf8"));
		expect(instanceMcp.mcpServers.fixture.toolExposure).toEqual({
			"*": "hidden",
			fixture_search: "direct",
		});
	}, 30_000);

	it("does not require an adapter extension for mcp_tools", async () => {
		await writeMcpConfig({ github: { url: "https://x" } });
		await writeCatalog({
			review: { mcp_tools: { github: ["search"] } },
		});

		const res = await runLauncher(fixture, ["review", "--", "--mode", "rpc"]);
		expect(res.code).toBe(0);

		const instanceDir = await soleInstanceDir(fixture);
		const instanceMcp = JSON.parse(await readFile(path.join(instanceDir, "mcp.json"), "utf8"));
		expect(instanceMcp.mcpServers.github.toolExposure).toEqual({ "*": "hidden", search: "direct" });
	}, 30_000);

	it("unknown server name in mcp_tools fails before spawn with candidates", async () => {
		await writeMcpConfig({ github: { url: "https://x" } });
		await writeCatalog({
			review: { mcp_tools: { typo_server: ["search"] } },
		});

		const res = await runLauncher(fixture, ["review", "--", "--mode", "rpc"]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain('unknown MCP server "typo_server"');
		expect(res.stderr).toContain("github");
	}, 30_000);

	it("project-only server is outside the narrowing boundary", async () => {
		await mkdir(path.join(fixture.cwd, ".pi"), { recursive: true });
		await writeFile(
			path.join(fixture.cwd, ".pi", "mcp.json"),
			JSON.stringify({ mcpServers: { proj_mcp: { url: "https://proj" } } }),
		);
		await writeFile(path.join(fixture.agentDir, "trust.json"), JSON.stringify({ [fixture.cwd]: true }));
		await writeMcpConfig({});
		await writeCatalog({
			narrow_project: { mcp_tools: { proj_mcp: ["search"] } },
		});

		const res = await runLauncher(fixture, ["narrow_project", "--", "--mode", "rpc"]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain('cannot narrow project-level MCP server "proj_mcp"');
	}, 30_000);

	it("empty mcp_tools object is inert", async () => {
		await writeMcpConfig({ github: { url: "https://x" } });
		await writeCatalog({
			plain: { mcp_tools: {} },
		});

		const res = await runLauncher(fixture, ["plain", "--", "--mode", "rpc"]);
		expect(res.code).toBe(0);

		const instanceDir = await soleInstanceDir(fixture);
		const instanceMcp = JSON.parse(await readFile(path.join(instanceDir, "mcp.json"), "utf8"));
		expect(instanceMcp.mcpServers.github.toolExposure).toBeUndefined();
	}, 30_000);

	it("literal server keys that shadow prototypes are resolved as data", async () => {
		await writeMcpConfig({ toString: { url: "https://x" } });
		await writeCatalog({
			string_server: JSON.parse('{"mcp_tools":{"toString":["search"]}}'),
		});

		const res = await runLauncher(fixture, ["string_server", "--", "--mode", "rpc"]);
		expect(res.code).toBe(0);

		const instanceDir = await soleInstanceDir(fixture);
		const instanceMcp = JSON.parse(await readFile(path.join(instanceDir, "mcp.json"), "utf8"));
		expect(Object.keys(instanceMcp.mcpServers)).toEqual(["toString"]);
		expect(instanceMcp.mcpServers.toString.toolExposure).toEqual({ "*": "hidden", search: "direct" });
	}, 30_000);
});
