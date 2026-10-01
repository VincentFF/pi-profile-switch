import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	LAUNCHER_BIN as BIN,
	launcherEnv,
	runLauncher,
} from "./helpers/launcher-runner.ts";
import { createPiFixture, launchInstanceDirs, soleInstanceDir, type PiFixture } from "./helpers/pi-fixture.ts";
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

async function writeMcpConfig(servers: Record<string, unknown>): Promise<void> {
	await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: servers }));
}

describe("launcher integration: native MCP snapshot semantics", () => {
	it(
		"a profile declaring mcp fails before spawn when the snapshot does not define it",
		{ timeout: 30_000 },
		async () => {
			await writeMcpConfig({ github: { url: "https://x" } });
			await writeCatalog({ review: { mcps: ["typo-server"] } });

			const failure = await runLauncher(fixture, ["review", "--", "--mode", "rpc"]);
			expect(failure.code).toBe(2);
			expect(failure.stderr).toContain('unknown MCP server: "typo-server"');
		},
	);

	it(
		"materializes the instance mcp.json as a generated snapshot, never a symlink",
		{ timeout: 45_000 },
		async () => {
			const globalConfig = { github: { url: "https://x" }, linear: { command: "mcp-linear" } };
			await writeMcpConfig(globalConfig);
			await writeCatalog({ review: { mcps: ["github"] } });

			const rpc = new RpcDriver("node", [BIN, "review", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const response = await rpc.send({ type: "get_state" });
				expect(response.success).toBe(true);
			} finally {
				await rpc.close();
			}

			const instanceMcpPath = path.join(await soleInstanceDir(fixture), "mcp.json");
			const stat = await (await import("node:fs/promises")).lstat(instanceMcpPath);
			expect(stat.isSymbolicLink()).toBe(false);
			expect(JSON.parse(await readFile(instanceMcpPath, "utf8"))).toEqual({
				mcpServers: {
					github: { url: "https://x" },
					linear: { command: "mcp-linear", enabled: false },
				},
			});

			expect(JSON.parse(await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8"))).toEqual({
				mcpServers: globalConfig,
			});
			expect(existsSync(path.join(fixture.cwd, ".pi", "mcp.json"))).toBe(false);
		},
	);

	it(
		"materializes the merged snapshot when no mcp allowlist is declared",
		{ timeout: 45_000 },
		async () => {
			const globalConfig = { github: { url: "https://x" } };
			await writeMcpConfig(globalConfig);
			await writeCatalog({ plain: {} });

			const rpc = new RpcDriver("node", [BIN, "plain", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const response = await rpc.send({ type: "get_state" });
				expect(response.success).toBe(true);
			} finally {
				await rpc.close();
			}

			const instanceMcpPath = path.join(await soleInstanceDir(fixture), "mcp.json");
			const stat = await (await import("node:fs/promises")).lstat(instanceMcpPath);
			expect(stat.isSymbolicLink()).toBe(false);
			expect(JSON.parse(await readFile(instanceMcpPath, "utf8"))).toEqual({
				mcpServers: globalConfig,
			});
		},
	);

	it(
		"fails before spawn when an explicitly selected server uses SSE",
		{ timeout: 30_000 },
		async () => {
			await writeMcpConfig({ github: { type: "sse", url: "http://localhost:3000/sse" } });
			await writeCatalog({ review: { mcps: ["github"] } });

			const failure = await runLauncher(fixture, ["review", "--", "--mode", "rpc"]);
			expect(failure.code).toBe(2);
			expect(failure.stderr).toContain('selected MCP server "github" uses the legacy SSE transport');
		},
	);

	it(
		"passes an unselected SSE server through and lets Pi report its own config error",
		{ timeout: 45_000 },
		async () => {
			await writeMcpConfig({ github: { type: "sse", url: "http://localhost:3000/sse" } });
			await writeCatalog({ plain: {} });

			const rpc = new RpcDriver("node", [BIN, "plain", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const response = await rpc.send({ type: "get_state" });
				expect(response.success).toBe(true);
			} finally {
				await rpc.close();
			}

			const instanceMcpPath = path.join(await soleInstanceDir(fixture), "mcp.json");
			expect(JSON.parse(await readFile(instanceMcpPath, "utf8"))).toEqual({
				mcpServers: {
					github: { type: "sse", url: "http://localhost:3000/sse" },
				},
			});
		},
	);

	it(
		"materializes tool restriction without a server whitelist and keeps original files byte-identical",
		{ timeout: 45_000 },
		async () => {
			const globalConfig = { github: { url: "https://x" }, linear: { command: "mcp-linear" } };
			await writeMcpConfig(globalConfig);
			await writeCatalog({ review: { mcp_tools: { github: ["search"] } } });

			const rpc = new RpcDriver("node", [BIN, "review", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const response = await rpc.send({ type: "get_state" });
				expect(response.success).toBe(true);
			} finally {
				await rpc.close();
			}

			const instanceMcpPath = path.join(await soleInstanceDir(fixture), "mcp.json");
			expect(JSON.parse(await readFile(instanceMcpPath, "utf8"))).toEqual({
				mcpServers: {
					github: { url: "https://x", toolExposure: { "*": "hidden", search: "direct" } },
					linear: { command: "mcp-linear" },
				},
			});

			expect(JSON.parse(await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8"))).toEqual({
				mcpServers: globalConfig,
			});
		},
	);

	it(
		"empty mcp_tools list denies all tools via toolExposure",
		{ timeout: 45_000 },
		async () => {
			const globalConfig = { github: { url: "https://x" } };
			await writeMcpConfig(globalConfig);
			await writeCatalog({ review: { mcp_tools: { github: [] } } });

			const rpc = new RpcDriver("node", [BIN, "review", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const response = await rpc.send({ type: "get_state" });
				expect(response.success).toBe(true);
			} finally {
				await rpc.close();
			}

			const instanceMcpPath = path.join(await soleInstanceDir(fixture), "mcp.json");
			expect(JSON.parse(await readFile(instanceMcpPath, "utf8"))).toEqual({
				mcpServers: {
					github: { url: "https://x", toolExposure: { "*": "hidden" } },
				},
			});
		},
	);

	it(
		"empty mcps selection disables discovered shared user servers and leaves source files unchanged",
		{ timeout: 45_000 },
		async () => {
			await mkdir(path.join(fixture.root, ".agents"), { recursive: true });
			const sharedConfig = { shared: { url: "https://shared" } };
			await writeFile(
				path.join(fixture.root, ".agents", "mcp.json"),
				JSON.stringify({ mcpServers: sharedConfig }),
			);
			const agentConfig = { agentonly: { url: "https://agent" } };
			await writeMcpConfig(agentConfig);
			const originalMcp = await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8");
			await writeCatalog({ denyall: { mcps: [] } });

			const rpc = new RpcDriver("node", [BIN, "denyall", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const response = await rpc.send({ type: "get_state" });
				expect(response.success).toBe(true);
			} finally {
				await rpc.close();
			}

			const instanceMcpPath = path.join(await soleInstanceDir(fixture), "mcp.json");
			const instanceMcp = JSON.parse(await readFile(instanceMcpPath, "utf8"));
			expect(instanceMcp.mcpServers).toEqual({
				shared: { url: "https://shared", enabled: false },
				agentonly: { url: "https://agent", enabled: false },
			});

			expect(await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8")).toBe(originalMcp);
			expect(JSON.parse(await readFile(path.join(fixture.root, ".agents", "mcp.json"), "utf8"))).toEqual({
				mcpServers: sharedConfig,
			});
		},
	);

	it(
		"project-sourced MCP server is not disabled by an empty mcps selection",
		{ timeout: 45_000 },
		async () => {
			await writeMcpConfig({});
			await mkdir(path.join(fixture.cwd, ".pi"), { recursive: true });
			await writeFile(
				path.join(fixture.cwd, ".pi", "mcp.json"),
				JSON.stringify({ mcpServers: { proj: { url: "https://proj" } } }),
			);
			await writeFile(path.join(fixture.agentDir, "trust.json"), JSON.stringify({ [fixture.cwd]: true }));
			await writeCatalog({ denyall: { mcps: [] } });

			const rpc = new RpcDriver("node", [BIN, "denyall", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const response = await rpc.send({ type: "get_state" });
				expect(response.success).toBe(true);
			} finally {
				await rpc.close();
			}

			const instanceMcpPath = path.join(await soleInstanceDir(fixture), "mcp.json");
			const instanceMcp = JSON.parse(await readFile(instanceMcpPath, "utf8"));
			expect(instanceMcp.mcpServers).toEqual({});
		},
	);

	it(
		"empty mcps selection with no discovered servers generates an empty instance mcp.json",
		{ timeout: 45_000 },
		async () => {
			await writeMcpConfig({});
			await writeCatalog({ empty: { mcps: [] } });

			const rpc = new RpcDriver("node", [BIN, "empty", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const response = await rpc.send({ type: "get_state" });
				expect(response.success).toBe(true);
			} finally {
				await rpc.close();
			}

			const instanceMcpPath = path.join(await soleInstanceDir(fixture), "mcp.json");
			expect(JSON.parse(await readFile(instanceMcpPath, "utf8"))).toEqual({ mcpServers: {} });
		},
	);

	it(
		"mcps: [] disables discovered stdio servers without connecting them or warning about missing transports",
		{ timeout: 45_000 },
		async () => {
			const marker = path.join(fixture.root, "mcp-server-started.marker");
			await mkdir(path.join(fixture.root, ".agents"), { recursive: true });
			await writeFile(
				path.join(fixture.root, ".agents", "mcp.json"),
				JSON.stringify({
					mcpServers: {
						shared: {
							command: "node",
							args: [path.resolve("test/fixtures/fixture-mcp-server.mjs")],
							env: { FIXTURE_MCP_START_MARKER: marker },
						},
					},
				}),
			);
			await writeMcpConfig({});
			await writeCatalog({ denyall: { mcps: [] } });

			const result = await runLauncher(fixture, ["denyall", "--", "--mode", "rpc"]);

			expect(result.code).toBe(0);
			expect(result.stderr).not.toContain('needs either "command"');
			// The disabled stdio server must never be spawned.
			expect(existsSync(marker)).toBe(false);
			const instanceMcp = JSON.parse(await readFile(path.join(await soleInstanceDir(fixture), "mcp.json"), "utf8"));
			expect(instanceMcp.mcpServers).toEqual({
				shared: {
					command: "node",
					args: [path.resolve("test/fixtures/fixture-mcp-server.mjs")],
					env: { FIXTURE_MCP_START_MARKER: marker },
					enabled: false,
				},
			});
		},
	);

	it(
		"merged user-level sources override earlier ones per server name",
		{ timeout: 45_000 },
		async () => {
			await mkdir(path.join(fixture.root, ".agents"), { recursive: true });
			await writeFile(
				path.join(fixture.root, ".agents", "mcp.json"),
				JSON.stringify({ mcpServers: { shared: { url: "https://agents" } } }),
			);
			await writeMcpConfig({ shared: { url: "https://agentdir" } });
			await writeCatalog({ plain: {} });

			const rpc = new RpcDriver("node", [BIN, "plain", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(fixture),
			});
			try {
				const response = await rpc.send({ type: "get_state" });
				expect(response.success).toBe(true);
			} finally {
				await rpc.close();
			}

			const instanceMcpPath = path.join(await soleInstanceDir(fixture), "mcp.json");
			expect(JSON.parse(await readFile(instanceMcpPath, "utf8"))).toEqual({
				mcpServers: {
					shared: { url: "https://agentdir" },
				},
			});
		},
	);
});
