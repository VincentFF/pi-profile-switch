import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	LAUNCHER_BIN as BIN,
	launcherEnv,
	runLauncher,
} from "./helpers/launcher-runner.ts";
import { createPiFixture, soleInstanceDir, type PiFixture } from "./helpers/pi-fixture.ts";
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

/** A fake pi-mcp-adapter: lives in a dir named like the real package (so the
 *  launcher's presence check matches). */
async function installFakeAdapter(): Promise<void> {
	const extFile = path.join(fixture.agentDir, "extensions", "pi-mcp-adapter.ts");
	await mkdir(path.dirname(extFile), { recursive: true });
	await writeFile(extFile, "export default function () {}\n");
}

describe("launcher integration: mcp coordination", () => {
	it(
		"a profile declaring mcp fails before spawn when the adapter is absent",
		{ timeout: 30_000 },
		async () => {
			await writeMcpConfig({ github: { url: "https://x" } });
			await writeCatalog({ review: { mcps: ["github"] } });

			const failure = await runLauncher(fixture, ["review", "--", "--mode", "rpc"]);
			expect(failure.code).toBe(2);
			expect(failure.stderr).toContain("pi-mcp-adapter is not active");
		},
	);

	it(
		"an mcp reference the adapter never discovered fails before spawn",
		{ timeout: 30_000 },
		async () => {
			await installFakeAdapter();
			await writeMcpConfig({ github: {} });
			await writeCatalog({ review: { extensions: ["pi-mcp-adapter"], mcps: ["typo-server"] } });

			const failure = await runLauncher(fixture, ["review", "--", "--mode", "rpc"]);
			expect(failure.code).toBe(2);
			expect(failure.stderr).toContain('unknown MCP server: "typo-server"');
		},
	);

	it(
		"filters the instance mcp.json to only allowed servers and never writes the adapter's original mcp.json",
		{ timeout: 45_000 },
		async () => {
			await installFakeAdapter();
			const globalConfig = { github: { url: "https://x" }, linear: { command: "mcp-linear" } };
			await writeMcpConfig(globalConfig);
			await writeCatalog({ review: { extensions: ["pi-mcp-adapter"], mcps: ["github"] } });

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

			// The generated instance mcp.json contains only the allowed server.
			const instanceMcpPath = path.join(await soleInstanceDir(fixture), "mcp.json");
			expect(JSON.parse(await readFile(instanceMcpPath, "utf8"))).toEqual({
				mcpServers: {
					github: { url: "https://x" },
				},
			});

			// The adapter's own files were never written: the global config is
			// byte-identical and no project overlay appeared.
			expect(JSON.parse(await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8"))).toEqual({
				mcpServers: globalConfig,
			});
			expect(existsSync(path.join(fixture.cwd, ".pi", "mcp.json"))).toBe(false);
		},
	);

	it(
		"a profile without mcp preserves the full mcp config via symlink",
		{ timeout: 45_000 },
		async () => {
			await installFakeAdapter();
			const globalConfig = { github: { url: "https://x" } };
			await writeMcpConfig(globalConfig);
			await writeCatalog({ plain: { extensions: ["pi-mcp-adapter"] } });

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

			// The instance mcp.json preserves the unrestricted config.
			const instanceMcpPath = path.join(await soleInstanceDir(fixture), "mcp.json");
			expect(JSON.parse(await readFile(instanceMcpPath, "utf8"))).toEqual({
				mcpServers: globalConfig,
			});
		},
	);
});
