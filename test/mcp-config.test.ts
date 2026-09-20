import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverAdapterServerNames, loadMergedMcpServers, McpConfigError } from "../src/mcp-config.ts";
import { createPiFixture, type PiFixture } from "./helpers/pi-fixture.ts";

let fixture: PiFixture;
let savedHome: string | undefined;

beforeEach(async () => {
	fixture = await createPiFixture();
	savedHome = process.env.HOME;
	process.env.HOME = fixture.root;
});

afterEach(async () => {
	process.env.HOME = savedHome;
	await rm(fixture.root, { recursive: true, force: true });
});

describe("discoverAdapterServerNames", () => {
	it("returns no names when no config exists", async () => {
		expect(await discoverAdapterServerNames(fixture.agentDir)).toEqual([]);
	});

	it("reads server names from the global agentDir mcp.json", async () => {
		await writeFile(
			path.join(fixture.agentDir, "mcp.json"),
			JSON.stringify({ mcpServers: { github: { url: "https://x" }, linear: { command: "mcp-linear" } } }),
		);

		expect(await discoverAdapterServerNames(fixture.agentDir)).toEqual(["github", "linear"]);
	});

	it("ignores non-server keys and never exposes connection config", async () => {
		await writeFile(
			path.join(fixture.agentDir, "mcp.json"),
			JSON.stringify({ mcpServers: { github: { url: "https://x", headers: { auth: "secret" } } }, settings: {} }),
		);

		expect(await discoverAdapterServerNames(fixture.agentDir)).toEqual(["github"]);
	});

	it("merges the trusted project's .pi/mcp.json and .mcp.json names", async () => {
		await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { github: {} } }));
		await writeFile(
			path.join(fixture.cwd, ".pi", "mcp.json"),
			JSON.stringify({ mcpServers: { "proj-server": {}, github: {} } }),
		);
		await writeFile(
			path.join(fixture.cwd, ".mcp.json"),
			JSON.stringify({ mcpServers: { "proj-shared": {} } }),
		);

		expect(await discoverAdapterServerNames(fixture.agentDir, fixture.cwd)).toEqual([
			"github",
			"proj-server",
			"proj-shared",
		]);
	});

	it("discovers servers from ~/.config/mcp/mcp.json, ~/.agents/mcp.json, and nested", async () => {
		await mkdir(path.join(fixture.root, ".config", "mcp"), { recursive: true });
		await writeFile(
			path.join(fixture.root, ".config", "mcp", "mcp.json"),
			JSON.stringify({ mcpServers: { "generic-global": { url: "https://x" } } }),
		);
		await mkdir(path.join(fixture.root, ".agents", "mcp"), { recursive: true });
		await writeFile(
			path.join(fixture.root, ".agents", "mcp.json"),
			JSON.stringify({ mcpServers: { "agents-global": { url: "https://y" } } }),
		);
		await writeFile(
			path.join(fixture.root, ".agents", "mcp", "mcp.json"),
			JSON.stringify({ mcpServers: { "agents-nested": { url: "https://z" } } }),
		);

		expect(await discoverAdapterServerNames(fixture.agentDir)).toEqual([
			"agents-global",
			"agents-nested",
			"generic-global",
		]);
	});

	it("fails loudly on a malformed ~/.agents/mcp.json config", async () => {
		await mkdir(path.join(fixture.root, ".agents"), { recursive: true });
		await writeFile(path.join(fixture.root, ".agents", "mcp.json"), "{ invalid json");

		await expect(discoverAdapterServerNames(fixture.agentDir)).rejects.toThrow(McpConfigError);
	});

	it("loadMergedMcpServers merges server definitions across sources with correct precedence", async () => {
		await mkdir(path.join(fixture.root, ".agents"), { recursive: true });
		await writeFile(
			path.join(fixture.root, ".agents", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					"shared-a": { url: "https://a-agents", key: "from-agents" },
					"shared-b": { url: "https://b" },
				},
			}),
		);
		await writeFile(
			path.join(fixture.agentDir, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					"shared-a": { url: "https://a-agentdir" },
					"local-c": { command: "c" },
				},
				settings: { custom: true },
			}),
		);

		const result = await loadMergedMcpServers(fixture.agentDir);
		expect(result.servers["shared-a"]).toEqual({ url: "https://a-agentdir", key: "from-agents" });
		expect(result.servers["shared-b"]).toEqual({ url: "https://b" });
		expect(result.servers["local-c"]).toEqual({ command: "c" });
		expect(result.sharedServers.has("shared-a")).toBe(true);
		expect(result.sharedServers.has("shared-b")).toBe(true);
		expect(result.sharedServers.has("local-c")).toBe(false);
		expect(result.baseConfig?.settings).toEqual({ custom: true });
	});

	it("marks servers defined by the trusted project as project servers", async () => {
		await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { "agent-a": {} } }));
		await writeFile(path.join(fixture.cwd, ".mcp.json"), JSON.stringify({ mcpServers: { "proj-shared": {} } }));
		await mkdir(path.join(fixture.cwd, ".pi"), { recursive: true });
		await writeFile(path.join(fixture.cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { "proj-owned": {} } }));

		const result = await loadMergedMcpServers(fixture.agentDir, fixture.cwd);

		expect([...result.projectServers].sort()).toEqual(["proj-owned", "proj-shared"]);
		expect(result.projectServers.has("agent-a")).toBe(false);
	});

	it("fails loudly on a malformed config instead of reading it as empty", async () => {
		await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: ["not-an-object"] }));

		await expect(discoverAdapterServerNames(fixture.agentDir)).rejects.toThrow(McpConfigError);
	});
});
