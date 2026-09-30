import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runLauncher } from "./helpers/launcher-runner.ts";
import { createPiFixture, launchInstanceDirs, soleInstanceDir, type PiFixture } from "./helpers/pi-fixture.ts";
import { computeServerHash } from "pi-mcp-adapter/metadata-cache";

let fixture: PiFixture;

const FIXTURE_SERVER_PATH = path.resolve("test/fixtures/fixture-mcp-server.mjs");
const REAL_ADAPTER_PATH = path.resolve("node_modules/pi-mcp-adapter/index.ts");

beforeEach(async () => {
	delete process.env.MCP_DIRECT_TOOLS;
	fixture = await createPiFixture();
});

afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true });
});

async function setupExtensions(): Promise<void> {
	const extDir = path.join(fixture.agentDir, "extensions");
	await mkdir(extDir, { recursive: true });

	// Adapter wrapper pointing to real adapter, capturing registered tool definitions
	await writeFile(
		path.join(extDir, "pi-mcp-adapter.ts"),
		`import adapter from ${JSON.stringify(REAL_ADAPTER_PATH)};
export default function (pi: any): void {
	const origRegisterTool = pi.registerTool.bind(pi);
	(globalThis as any).__adapterTools = (globalThis as any).__adapterTools ?? new Map();
	pi.registerTool = (tool: any) => {
		(globalThis as any).__adapterTools.set(tool.name, tool);
		return origRegisterTool(tool);
	};
	return adapter(pi);
}
`,
	);

	// Probe extension to exercise tools inside Pi
	const probeSource = `
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export default function probeExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		const root = ${JSON.stringify(fixture.root)};
		const planPath = path.join(root, "probe-plan.json");
		let plan: any = null;
		try {
			plan = JSON.parse(await readFile(planPath, "utf8"));
		} catch {
			return;
		}

		const results: any[] = [];
		const adapterTools = (globalThis as any).__adapterTools ?? new Map();
		const mcpTool = adapterTools.get("mcp");
		const scriptTool = adapterTools.get("mcpScript");

		for (const action of plan.actions ?? []) {
			try {
				if (action.type === "record_tools") {
					results.push({
						type: "record_tools",
						allTools: pi.getAllTools().map((t: any) => t.name),
						activeTools: pi.getActiveTools(),
						registeredToolNames: Array.from(adapterTools.keys()),
					});
				} else if (action.type === "connect") {
					if (!mcpTool) {
						results.push({ type: "connect", error: "mcp tool not registered" });
					} else {
						const res = await mcpTool.execute("c1", { connect: action.server }, undefined, undefined, ctx);
						results.push({ type: "connect", result: res });
					}
				} else if (action.type === "call_mcp") {
					if (!mcpTool) {
						results.push({ type: "call_mcp", error: "mcp tool not registered" });
					} else {
						const res = await mcpTool.execute(
							"c2",
							{ tool: action.tool, server: action.server, args: action.args },
							undefined,
							undefined,
							ctx,
						);
						results.push({ type: "call_mcp", result: res });
					}
				} else if (action.type === "call_direct") {
					const tool = adapterTools.get(action.tool);
					if (!tool) {
						results.push({ type: "call_direct", error: "tool not registered" });
					} else {
						const res = await tool.execute("c3", action.args, undefined, undefined, ctx);
						results.push({ type: "call_direct", result: res });
					}
				} else if (action.type === "call_namespace") {
					const nsToolName = "mcp__" + action.server;
					const tool = adapterTools.get(nsToolName);
					if (!tool) {
						results.push({ type: "call_namespace", error: nsToolName + " not registered" });
					} else {
						const res = await tool.execute(
							"c4",
							{ tool: action.tool, args: action.args },
							undefined,
							undefined,
							ctx,
						);
						results.push({ type: "call_namespace", result: res });
					}
				} else if (action.type === "call_script") {
					if (!scriptTool) {
						results.push({ type: "call_script", error: "mcpScript not registered" });
					} else {
						const res = await scriptTool.execute("c5", { code: action.code }, undefined, undefined, ctx);
						results.push({ type: "call_script", result: res });
					}
				} else if (action.type === "trigger_late_tools") {
					await writeFile(action.file, JSON.stringify(action.tools));
					results.push({ type: "trigger_late_tools", done: true });
				} else if (action.type === "wait") {
					await new Promise((resolve) => setTimeout(resolve, action.ms ?? 500));
					results.push({ type: "wait", done: true });
				}
			} catch (err: any) {
				results.push({ type: action.type, threw: err.message });
			}
		}

		await writeFile(path.join(root, "probe-output.json"), JSON.stringify(results, null, 2));
	});
}
`;
	await writeFile(path.join(extDir, "probe.ts"), probeSource);
}

async function writeProbePlan(actions: any[]): Promise<void> {
	await writeFile(path.join(fixture.root, "probe-plan.json"), JSON.stringify({ actions }));
}

async function readProbeOutput(): Promise<any[]> {
	const raw = await readFile(path.join(fixture.root, "probe-output.json"), "utf8");
	return JSON.parse(raw);
}

async function writeCatalog(profiles: Record<string, unknown>): Promise<void> {
	const dir = path.join(fixture.profileSwitchDir, "profiles");
	await mkdir(dir, { recursive: true });
	for (const [name, definition] of Object.entries(profiles)) {
		await writeFile(path.join(dir, `${name}.json`), JSON.stringify(definition));
	}
}

describe("launcher integration: empty mcps selection disables user-level servers (honor-empty-mcp-allowlist)", () => {
	it("a shared user-level server and an agentDir-only server cannot be used under mcps: [], while a trusted project server remains callable", async () => {
		await setupExtensions();

		const sharedMcp = {
			mcpServers: {
				shared_srv: {
					command: "node",
					args: [FIXTURE_SERVER_PATH],
				},
			},
		};
		const agentMcp = {
			mcpServers: {
				agent_srv: {
					command: "node",
					args: [FIXTURE_SERVER_PATH],
				},
			},
		};
		const projectMcp = {
			mcpServers: {
				proj_srv: {
					command: "node",
					args: [FIXTURE_SERVER_PATH],
				},
			},
		};

		await mkdir(path.join(fixture.root, ".agents"), { recursive: true });
		await writeFile(path.join(fixture.root, ".agents", "mcp.json"), JSON.stringify(sharedMcp));
		await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify(agentMcp));
		await mkdir(path.join(fixture.cwd, ".pi"), { recursive: true });
		await writeFile(path.join(fixture.cwd, ".pi", "mcp.json"), JSON.stringify(projectMcp));
		await writeFile(path.join(fixture.agentDir, "trust.json"), JSON.stringify({ [fixture.cwd]: true }));

		const originalShared = JSON.stringify(sharedMcp);
		const originalAgent = JSON.stringify(agentMcp);
		const originalProject = JSON.stringify(projectMcp);

		await writeCatalog({
			denyall: {
				extensions: ["pi-mcp-adapter", "probe"],
				mcps: [],
			},
		});

		await writeProbePlan([
			{ type: "connect", server: "shared_srv" },
			{ type: "call_mcp", tool: "search", server: "shared_srv", args: { query: "shared-q" } },
			{ type: "connect", server: "agent_srv" },
			{ type: "call_mcp", tool: "search", server: "agent_srv", args: { query: "agent-q" } },
			{ type: "connect", server: "proj_srv" },
			{ type: "call_mcp", tool: "search", server: "proj_srv", args: { query: "proj-q" } },
		]);

		const res = await runLauncher(fixture, ["denyall", "--", "--mode", "json"]);
		expect(res.code).toBe(0);

		const instanceDir = await soleInstanceDir(fixture);
		const instanceMcp = JSON.parse(await readFile(path.join(instanceDir, "mcp.json"), "utf8"));
		expect(instanceMcp.mcpServers.shared_srv).toEqual({ disabled: true });
		expect(instanceMcp.mcpServers.agent_srv).toBeUndefined();
		expect(instanceMcp.mcpServers.proj_srv).toBeUndefined();

		expect(await readFile(path.join(fixture.root, ".agents", "mcp.json"), "utf8")).toBe(originalShared);
		expect(await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8")).toBe(originalAgent);
		expect(await readFile(path.join(fixture.cwd, ".pi", "mcp.json"), "utf8")).toBe(originalProject);

		const output = await readProbeOutput();
		const sharedConnect = output.find((o) => o.type === "connect" && o.result?.details?.server === "shared_srv");
		expect(sharedConnect?.result?.details?.error).toBe("server_disabled");
		const sharedCall = output.find((o) => o.type === "call_mcp" && o.result?.details?.server === "shared_srv");
		expect(sharedCall?.result?.details?.error).toBe("server_disabled");

		const agentConnect = output.find((o) => o.type === "connect" && o.result?.details?.server === "agent_srv");
		expect(agentConnect?.result?.details?.error).toBe("not_found");
		const agentCall = output.find((o) => o.type === "call_mcp" && o.result?.details?.server === "agent_srv");
		expect(agentCall?.result?.details?.error).toBe("server_not_found");

		const projConnect = output.find((o) => o.type === "connect" && o.result?.details?.server === "proj_srv");
		expect(projConnect?.result?.details?.tools).toEqual(["proj_srv_search", "proj_srv_delete"]);
		const projCall = output.find((o) => o.type === "call_mcp" && o.result?.details?.server === "proj_srv");
		expect(projCall?.result?.content?.[0]?.text).toContain("search-result:proj-q");
	}, 60_000);
});

describe("launcher integration: per-server MCP tool selection (Task 2.2)", () => {
	it("direct tools: executes allowed direct tools and excludes unlisted direct tools", async () => {
		await setupExtensions();

		const serverDef = {
			command: "node",
			args: [FIXTURE_SERVER_PATH],
			directTools: true,
		};
		await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { fixture: serverDef } }));

		// Seed cache in agentDir with matching configHash for direct tool bootstrap
		const effectiveDef = { ...serverDef, includeTools: ["search"] };
		const configHash = computeServerHash(effectiveDef);
		const initialCache = {
			version: 1,
			servers: {
				fixture: {
					configHash,
					cachedAt: Date.now(),
					tools: [
						{ name: "search", description: "Search items", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
						{ name: "delete", description: "Delete item", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
					],
				},
			},
		};
		await writeFile(path.join(fixture.agentDir, "mcp-cache.json"), JSON.stringify(initialCache));

		await writeCatalog({
			direct_test: {
				extensions: ["pi-mcp-adapter", "probe"],
				mcp_tools: {
					fixture: ["search"],
				},
			},
		});

		await writeProbePlan([
			{ type: "record_tools" },
			{ type: "call_direct", tool: "fixture_search", args: { query: "direct-param-123" } },
			{ type: "call_direct", tool: "fixture_delete", args: { id: "direct-del-123" } },
		]);

		const res = await runLauncher(fixture, ["direct_test", "--", "--mode", "json"]);
		expect(res.code).toBe(0);

		const output = await readProbeOutput();
		const record = output.find((o) => o.type === "record_tools");
		expect(record.registeredToolNames).toContain("fixture_search");
		expect(record.registeredToolNames).not.toContain("fixture_delete");

		const directSearch = output.find((o) => o.type === "call_direct" && o.result !== undefined);
		expect(directSearch.result.content[0].text).toContain("search-result:direct-param-123");

		const directDelete = output.find((o) => o.type === "call_direct" && o.error !== undefined);
		expect(directDelete.error).toBe("tool not registered");
	}, 30_000);

	it("a prefixed literal selects the original tool through the namespace proxy", async () => {
		await setupExtensions();

		const serverDef = {
			command: "node",
			args: [FIXTURE_SERVER_PATH],
		};
		await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { fixture: serverDef } }));

		// Seed cache so namespace proxy can register at startup
		const selector = "fixture_search";
		const effectiveDef = { ...serverDef, includeTools: [selector] };
		const configHash = computeServerHash(effectiveDef);
		const initialCache = {
			version: 1,
			servers: {
				fixture: {
					configHash,
					cachedAt: Date.now(),
					tools: [
						{ name: "search", description: "Search items", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
						{ name: "delete", description: "Delete item", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
					],
				},
			},
		};
		await writeFile(path.join(fixture.agentDir, "mcp-cache.json"), JSON.stringify(initialCache));

		await writeCatalog({
			ns_test: {
				extensions: ["pi-mcp-adapter", "probe"],
				mcp_tools: {
					fixture: [selector],
				},
			},
		});

		await writeProbePlan([
			{ type: "record_tools" },
			{ type: "connect", server: "fixture" },
			{ type: "call_mcp", tool: "search", server: "fixture", args: { query: "ns-gateway-val" } },
			{ type: "call_namespace", server: "fixture", tool: "search", args: { query: "ns-query-val" } },
			{ type: "call_script", code: `const r = await tools.call("fixture_search", { query: "ns-script-val" }); emit(r);` },
			{ type: "call_namespace", server: "fixture", tool: "delete", args: { id: "ns-del-val" } },
		]);

		const res = await runLauncher(fixture, ["ns_test", "--", "--mode", "json"]);
		expect(res.code).toBe(0);

		const output = await readProbeOutput();
		const record = output.find((o) => o.type === "record_tools");
		expect(record.registeredToolNames).toContain("mcp__fixture");
		const connect = output.find((o) => o.type === "connect");
		expect(connect.result.details.tools).toEqual(["fixture_search"]);

		const gatewaySearch = output.find((o) => o.type === "call_mcp" && o.result.details?.tool === "search");
		expect(gatewaySearch.result.content[0].text).toContain("search-result:ns-gateway-val");
		const nsSearch = output.find((o) => o.type === "call_namespace" && o.result?.content?.[0]?.text?.includes("search-result"));
		expect(nsSearch).toBeDefined();
		expect(nsSearch.result.content[0].text).toContain("search-result:ns-query-val");
		const scriptSearch = output.find((o) => o.type === "call_script");
		expect(scriptSearch.result.details.calls[0].ok).toBe(true);

		const nsDelete = output.find((o) => o.type === "call_namespace" && o.result?.details?.requestedTool === "delete");
		expect(nsDelete).toBeDefined();
		expect(nsDelete.result.details.error).toBe("tool_not_found");
		expect(nsDelete.result.content[0].text).toContain('Tool "delete" not found');
	}, 30_000);

	it("gateway and script: explicit per-server whitelist allows only whitelisted tools and blocks excluded tools", async () => {
		await setupExtensions();

		const globalMcp = {
			fixture: {
				command: "node",
				args: [FIXTURE_SERVER_PATH],
				directTools: true,
			},
		};
		await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: globalMcp }));

		await writeCatalog({
			whitelist: {
				extensions: ["pi-mcp-adapter", "probe"],
				mcp_tools: {
					fixture: ["search"],
				},
			},
		});

		await writeProbePlan([
			{ type: "record_tools" },
			{ type: "connect", server: "fixture" },
			{ type: "call_mcp", tool: "search", server: "fixture", args: { query: "query-arg" } },
			{ type: "call_mcp", tool: "delete", server: "fixture", args: { id: "item-1" } },
			{
				type: "call_script",
				code: `const r = await tools.call("fixture_delete", { id: "item-1" }); emit(r);`,
			},
		]);

		const res = await runLauncher(fixture, ["whitelist", "--", "--mode", "json"]);
		expect(res.code).toBe(0);

		const output = await readProbeOutput();
		const connect = output.find((o) => o.type === "connect");
		expect(connect.result.details.tools).toEqual(["fixture_search"]);
		expect(connect.result.details.count).toBe(1);

		const searchCall = output.find((o) => o.type === "call_mcp" && o.result.details?.tool === "search");
		expect(searchCall.result.content[0].text).toContain("search-result:query-arg");

		const deleteCall = output.find((o) => o.type === "call_mcp" && o.result.details?.requestedTool === "delete");
		expect(deleteCall.result.details.error).toBe("tool_not_found");
		expect(deleteCall.result.content[0].text).toContain('Tool "delete" not found');

		const scriptCall = output.find((o) => o.type === "call_script");
		expect(scriptCall.result.details.calls[0].ok).toBe(false);
		expect(scriptCall.result.details.calls[0].error).toBe("tool_not_found");
	}, 30_000);

	it("an unknown MCP tool name stays restrictive without diagnostics on direct or indirect routes", async () => {
		await setupExtensions();
		await writeFile(
			path.join(fixture.agentDir, "mcp.json"),
			JSON.stringify({ mcpServers: { fixture: { command: "node", args: [FIXTURE_SERVER_PATH], directTools: true } } }),
		);
		await writeCatalog({
			unknown_name: {
				extensions: ["pi-mcp-adapter", "probe"],
				mcp_tools: { fixture: ["serach"] },
			},
		});
		await writeProbePlan([
			{ type: "record_tools" },
			{ type: "connect", server: "fixture" },
			{ type: "call_direct", tool: "fixture_search", args: { query: "blocked-direct" } },
			{ type: "call_mcp", tool: "search", server: "fixture", args: { query: "blocked-gateway" } },
			{ type: "call_namespace", server: "fixture", tool: "search", args: { query: "blocked-namespace" } },
			{ type: "call_script", code: `const r = await tools.call("fixture_search", { query: "blocked-script" }); emit(r);` },
		]);

		const res = await runLauncher(fixture, ["unknown_name", "--", "--mode", "json"]);
		expect(res.code).toBe(0);
		const instanceDir = await soleInstanceDir(fixture);
		const instanceMcp = JSON.parse(await readFile(path.join(instanceDir, "mcp.json"), "utf8"));
		expect(instanceMcp.mcpServers.fixture.includeTools).toEqual(["serach"]);

		const output = await readProbeOutput();
		const connect = output.find((entry) => entry.type === "connect");
		expect(connect.result.details.count).toBe(0);
		const direct = output.find((entry) => entry.type === "call_direct");
		expect(direct.error).toBe("tool not registered");
		const gateway = output.find((entry) => entry.type === "call_mcp");
		expect(gateway.result.details.error).toBe("tool_not_found");
		const namespace = output.find((entry) => entry.type === "call_namespace");
		expect(namespace.error !== undefined || namespace.result?.details?.error === "tool_not_found").toBe(true);
		const script = output.find((entry) => entry.type === "call_script");
		expect(script.result.details.calls[0].ok).toBe(false);
		expect(script.result.details.calls[0].error).toBe("tool_not_found");

		const outputText = `${res.stdout}\n${res.stderr}`;
		expect(outputText).not.toMatch(/profile "unknown_name": MCP server.*tool.*not found/i);
		expect(outputText).not.toMatch(/did you mean/i);
	}, 30_000);

	it("a prefixed literal selects the original tool through direct, gateway, and script routes", async () => {
		await setupExtensions();

		const serverDef = {
			command: "node",
			args: [FIXTURE_SERVER_PATH],
			directTools: true,
		};
		const originalMcpContent = JSON.stringify({ mcpServers: { fixture: serverDef } });
		await writeFile(path.join(fixture.agentDir, "mcp.json"), originalMcpContent);

		const selector = "fixture_search";
		const configHash = computeServerHash({ ...serverDef, includeTools: [selector] });
		await writeFile(
			path.join(fixture.agentDir, "mcp-cache.json"),
			JSON.stringify({
				version: 1,
				servers: {
					fixture: {
						configHash,
						cachedAt: Date.now(),
						tools: [
							{ name: "search", description: "Search items", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
							{ name: "delete", description: "Delete item", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
						],
					},
				},
			}),
		);

		await writeCatalog({
			prefixed_selector: {
				extensions: ["pi-mcp-adapter", "probe"],
				mcp_tools: { fixture: [selector] },
			},
		});
		await writeProbePlan([
			{ type: "record_tools" },
			{ type: "connect", server: "fixture" },
			{ type: "call_direct", tool: "fixture_search", args: { query: "prefix-direct" } },
			{ type: "call_mcp", tool: "search", server: "fixture", args: { query: "prefix-gateway" } },
			{ type: "call_script", code: `const r = await tools.call("fixture_search", { query: "prefix-script" }); emit(r);` },
			{ type: "call_direct", tool: "fixture_delete", args: { id: "denied-direct" } },
			{ type: "call_mcp", tool: "delete", server: "fixture", args: { id: "denied-gateway" } },
			{ type: "call_script", code: `const r = await tools.call("fixture_delete", { id: "denied-script" }); emit(r);` },
		]);

		const res = await runLauncher(fixture, ["prefixed_selector", "--", "--mode", "json"]);
		expect(res.code).toBe(0);

		const instanceDir = await soleInstanceDir(fixture);
		const instanceMcp = JSON.parse(await readFile(path.join(instanceDir, "mcp.json"), "utf8"));
		expect(instanceMcp.mcpServers.fixture.includeTools).toEqual([selector]);
		expect(await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8")).toBe(originalMcpContent);

		const output = await readProbeOutput();
		const record = output.find((entry) => entry.type === "record_tools");
		expect(record.registeredToolNames).toContain("fixture_search");
		expect(record.registeredToolNames).not.toContain("fixture_delete");
		const connect = output.find((entry) => entry.type === "connect");
		expect(connect.result.details.tools).toEqual(["fixture_search"]);

		const direct = output.find((entry) => entry.type === "call_direct" && entry.result !== undefined);
		expect(direct.result.content[0].text).toContain("search-result:prefix-direct");
		const gateway = output.find((entry) => entry.type === "call_mcp" && entry.result.details?.tool === "search");
		expect(gateway.result.content[0].text).toContain("search-result:prefix-gateway");
		const script = output.find((entry) => entry.type === "call_script" && entry.result.details.calls[0].ok);
		expect(script.result.details.calls[0].ok).toBe(true);

		const directDenied = output.find((entry) => entry.type === "call_direct" && entry.error !== undefined);
		expect(directDenied.error).toBe("tool not registered");
		const gatewayDenied = output.find((entry) => entry.type === "call_mcp" && entry.result.details?.requestedTool === "delete");
		expect(gatewayDenied.result.details.error).toBe("tool_not_found");
		const scriptDenied = output.filter((entry) => entry.type === "call_script").at(-1);
		expect(scriptDenied.result.details.calls[0].ok).toBe(false);
		expect(scriptDenied.result.details.calls[0].error).toBe("tool_not_found");
	}, 30_000);

	it("real adapter can discover an own toString server key", async () => {
		await setupExtensions();
		const originalMcpContent = `{"mcpServers":{"toString":{"command":"node","args":[${JSON.stringify(FIXTURE_SERVER_PATH)}]}}}`;
		await writeFile(path.join(fixture.agentDir, "mcp.json"), originalMcpContent);
		await writeCatalog({
			string_server: {
				extensions: ["pi-mcp-adapter", "probe"],
				mcp_tools: JSON.parse('{"toString":["search"]}'),
			},
		});
		await writeProbePlan([
			{ type: "connect", server: "toString" },
			{ type: "call_mcp", tool: "search", server: "toString", args: { query: "to-string-control" } },
		]);

		const res = await runLauncher(fixture, ["string_server", "--", "--mode", "json"]);
		expect(res.code).toBe(0);
		const instanceDir = await soleInstanceDir(fixture);
		const instanceMcp = JSON.parse(await readFile(path.join(instanceDir, "mcp.json"), "utf8"));
		expect(Object.keys(instanceMcp.mcpServers)).toEqual(["toString"]);
		expect(instanceMcp.mcpServers.toString.includeTools).toEqual(["search"]);
		expect(await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8")).toBe(originalMcpContent);

		const output = await readProbeOutput();
		const connect = output.find((entry) => entry.type === "connect");
		expect(connect.result.details.tools).toEqual(["toString_search"]);
		const search = output.find((entry) => entry.type === "call_mcp");
		expect(search.result.content[0].text).toContain("search-result:to-string-control");
	}, 30_000);

	it("rejects a profile __proto__ key the real adapter cannot discover before runtime writes", async () => {
		await setupExtensions();
		const originalMcpContent = `{"mcpServers":{"__proto__":{"command":"node","args":[${JSON.stringify(FIXTURE_SERVER_PATH)}]},"toString":{"command":"node","args":[${JSON.stringify(FIXTURE_SERVER_PATH)}]}}}`;
		const parsedConfig = JSON.parse(originalMcpContent);
		expect(Object.hasOwn(parsedConfig.mcpServers, "__proto__")).toBe(true);
		await writeFile(path.join(fixture.agentDir, "mcp.json"), originalMcpContent);
		await writeCatalog({
			unsupported_proto: JSON.parse(
				'{"extensions":["pi-mcp-adapter","probe"],"mcp_tools":{"__proto__":["search"]}}',
			),
		});

		const res = await runLauncher(fixture, ["unsupported_proto", "--", "--mode", "json"]);

		expect(res.code).toBe(2);
		expect(res.stderr).toMatch(/unknown MCP server "__proto__".*toString/s);
		expect(await launchInstanceDirs(fixture)).toEqual([]);
		expect(await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8")).toBe(originalMcpContent);
	}, 30_000);

	it("fails before runtime creation when a prior includeTools spelling collides with a profile alias", async () => {
		await setupExtensions();
		const originalMcpContent = JSON.stringify({
			mcpServers: { fixture: { command: "node", args: [FIXTURE_SERVER_PATH], includeTools: ["foo_bar"] } },
		});
		await writeFile(path.join(fixture.agentDir, "mcp.json"), originalMcpContent);
		await writeCatalog({
			unsafe_alias: {
				extensions: ["pi-mcp-adapter", "probe"],
				mcp_tools: { fixture: ["foo-bar"] },
			},
		});

		const res = await runLauncher(fixture, ["unsafe_alias", "--", "--mode", "json"]);

		expect(res.code).toBe(2);
		expect(res.stderr).toContain('unsafe MCP tool filter intersection for server "fixture"');
		expect(res.stderr).toContain('"foo-bar"');
		expect(await launchInstanceDirs(fixture)).toEqual([]);
		expect(await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8")).toBe(originalMcpContent);
	}, 30_000);

	it("empty server list denies all tools while keeping server enabled and user files untouched", async () => {
		await setupExtensions();

		const originalMcpContent = JSON.stringify({
			mcpServers: {
				fixture: {
					command: "node",
					args: [FIXTURE_SERVER_PATH],
				},
			},
		});
		await writeFile(path.join(fixture.agentDir, "mcp.json"), originalMcpContent);

		await writeCatalog({
			denyall: {
				extensions: ["pi-mcp-adapter", "probe"],
				mcp_tools: {
					fixture: [],
				},
			},
		});

		await writeProbePlan([
			{ type: "connect", server: "fixture" },
			{ type: "call_mcp", tool: "search", server: "fixture", args: { query: "q" } },
			{ type: "call_mcp", tool: "delete", server: "fixture", args: { id: "d" } },
			{ type: "call_direct", tool: "fixture_search", args: { query: "q" } },
			{ type: "call_namespace", server: "fixture", tool: "search", args: { query: "q" } },
		]);

		const res = await runLauncher(fixture, ["denyall", "--", "--mode", "json"]);
		expect(res.code).toBe(0);

		// Instance mcp.json contains excludeTools: ["*"]
		const instanceDir = await soleInstanceDir(fixture);
		const instanceMcp = JSON.parse(await readFile(path.join(instanceDir, "mcp.json"), "utf8"));
		expect(instanceMcp.mcpServers.fixture.excludeTools).toEqual(["*"]);

		// User file byte identity is completely preserved
		const actualUserMcp = await readFile(path.join(fixture.agentDir, "mcp.json"), "utf8");
		expect(actualUserMcp).toBe(originalMcpContent);

		const output = await readProbeOutput();
		const connect = output.find((o) => o.type === "connect");
		// Server connected (non-tool functions work), but exposes 0 tools
		expect(connect.result.details.count).toBe(0);

		// Calls to search and delete fail through gateway
		const searchCall = output.find((o) => o.type === "call_mcp" && o.result.details?.requestedTool === "search");
		expect(searchCall.result.details.error).toBe("tool_not_found");

		const deleteCall = output.find((o) => o.type === "call_mcp" && o.result.details?.requestedTool === "delete");
		expect(deleteCall.result.details.error).toBe("tool_not_found");

		// Direct and namespace tools are not registered / denied
		const directCall = output.find((o) => o.type === "call_direct");
		expect(directCall.error).toBe("tool not registered");

		const nsCall = output.find((o) => o.type === "call_namespace");
		expect(nsCall.error !== undefined || nsCall.result?.details?.error === "tool_not_found").toBe(true);
	}, 30_000);

	it("missing server key defaults to all tools", async () => {
		await setupExtensions();

		await writeFile(
			path.join(fixture.agentDir, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					fixture: {
						command: "node",
						args: [FIXTURE_SERVER_PATH],
					},
				},
			}),
		);

		// Profile does NOT specify mcp_tools (omits fixture)
		await writeCatalog({
			unrestricted: {
				extensions: ["pi-mcp-adapter", "probe"],
			},
		});

		await writeProbePlan([
			{ type: "connect", server: "fixture" },
			{ type: "call_mcp", tool: "search", server: "fixture", args: { query: "search-all" } },
			{ type: "call_mcp", tool: "delete", server: "fixture", args: { id: "del-all" } },
		]);

		const res = await runLauncher(fixture, ["unrestricted", "--", "--mode", "json"]);
		expect(res.code).toBe(0);

		const output = await readProbeOutput();
		const connect = output.find((o) => o.type === "connect");
		expect(connect.result.details.tools).toEqual(["fixture_search", "fixture_delete"]);
		expect(connect.result.details.count).toBe(2);

		const searchCall = output.find((o) => o.type === "call_mcp" && o.result.details?.tool === "search");
		expect(searchCall.result.content[0].text).toContain("search-result:search-all");

		const deleteCall = output.find((o) => o.type === "call_mcp" && o.result.details?.tool === "delete");
		expect(deleteCall.result.content[0].text).toContain("delete-result:del-all");
	}, 30_000);

	it("project-only server is outside the narrowing boundary", async () => {
		await setupExtensions();

		// Put fixture server strictly in project .pi/mcp.json
		const projectPiDir = path.join(fixture.cwd, ".pi");
		await mkdir(projectPiDir, { recursive: true });
		await writeFile(
			path.join(projectPiDir, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					proj_mcp: {
						command: "node",
						args: [FIXTURE_SERVER_PATH],
					},
				},
			}),
		);
		// Trust the project
		await writeFile(path.join(fixture.agentDir, "trust.json"), JSON.stringify({ [fixture.cwd]: true }));

		// Global mcp.json is empty
		await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: {} }));

		// Profile attempts to narrow project-level proj_mcp
		await writeCatalog({
			narrow_project: {
				extensions: ["pi-mcp-adapter"],
				mcp_tools: {
					proj_mcp: ["search"],
				},
			},
		});

		const res = await runLauncher(fixture, ["narrow_project", "--", "--mode", "json"]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain('cannot narrow project-level MCP server "proj_mcp"');
		expect(res.stderr).toContain("project-level servers are outside profile narrowing");
	}, 30_000);

	it("post-connection tool-list update allows late-discovered whitelisted tool and blocks late-discovered denied tool", async () => {
		await setupExtensions();

		const dynamicToolsFile = path.join(fixture.root, "dynamic-tools.json");
		const globalMcp = {
			fixture: {
				command: "node",
				args: [FIXTURE_SERVER_PATH],
				env: {
					FIXTURE_DYNAMIC_TOOLS_FILE: dynamicToolsFile,
				},
			},
		};
		await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: globalMcp }));

		await writeCatalog({
			late_test: {
				extensions: ["pi-mcp-adapter", "probe"],
				mcp_tools: {
					fixture: ["search", "late_allowed"],
				},
			},
		});

		const updatedToolsList = [
			{
				name: "search",
				description: "Search items",
				inputSchema: { type: "object", properties: { query: { type: "string" } } },
			},
			{
				name: "delete",
				description: "Delete item",
				inputSchema: { type: "object", properties: { id: { type: "string" } } },
			},
			{
				name: "late_allowed",
				description: "Late allowed tool",
				inputSchema: { type: "object", properties: { param: { type: "string" } } },
			},
			{
				name: "late_denied",
				description: "Late denied tool",
				inputSchema: { type: "object", properties: { param: { type: "string" } } },
			},
		];

		await writeProbePlan([
			{ type: "connect", server: "fixture" },
			{ type: "trigger_late_tools", file: dynamicToolsFile, tools: updatedToolsList },
			{ type: "wait", ms: 400 },
			{ type: "call_mcp", tool: "late_allowed", server: "fixture", args: { param: "val1" } },
			{ type: "call_mcp", tool: "late_denied", server: "fixture", args: { param: "val2" } },
		]);

		const res = await runLauncher(fixture, ["late_test", "--", "--mode", "json"]);
		expect(res.code).toBe(0);

		const output = await readProbeOutput();
		const allowedCall = output.find((o) => o.type === "call_mcp" && o.result.details?.tool === "late_allowed");
		expect(allowedCall).toBeDefined();
		expect(allowedCall.result.content[0].text).toContain("late_allowed-result:val1");

		const deniedCall = output.find((o) => o.type === "call_mcp" && o.result.details?.requestedTool === "late_denied");
		expect(deniedCall).toBeDefined();
		expect(deniedCall.result.details.error).toBe("tool_not_found");
	}, 30_000);

	it("post-connection tool-list update under empty tool list: all late tools remain denied and inaccessible", async () => {
		await setupExtensions();

		const dynamicToolsFile = path.join(fixture.root, "dynamic-tools.json");
		const globalMcp = {
			fixture: {
				command: "node",
				args: [FIXTURE_SERVER_PATH],
				env: {
					FIXTURE_DYNAMIC_TOOLS_FILE: dynamicToolsFile,
				},
			},
		};
		await writeFile(path.join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: globalMcp }));

		await writeCatalog({
			empty_late_test: {
				extensions: ["pi-mcp-adapter", "probe"],
				mcp_tools: {
					fixture: [],
				},
			},
		});

		const updatedToolsList = [
			{
				name: "search",
				description: "Search items",
				inputSchema: { type: "object", properties: { query: { type: "string" } } },
			},
			{
				name: "new_late_tool",
				description: "New late tool",
				inputSchema: { type: "object", properties: { x: { type: "string" } } },
			},
		];

		await writeProbePlan([
			{ type: "connect", server: "fixture" },
			{ type: "trigger_late_tools", file: dynamicToolsFile, tools: updatedToolsList },
			{ type: "wait", ms: 400 },
			{ type: "call_mcp", tool: "new_late_tool", server: "fixture", args: { x: "test" } },
			{ type: "call_direct", tool: "fixture_new_late_tool", args: { x: "test" } },
		]);

		const res = await runLauncher(fixture, ["empty_late_test", "--", "--mode", "json"]);
		expect(res.code).toBe(0);

		const output = await readProbeOutput();
		const mcpCall = output.find((o) => o.type === "call_mcp");
		expect(mcpCall.result.details.error).toBe("tool_not_found");

		const directCall = output.find((o) => o.type === "call_direct");
		expect(directCall.error).toBe("tool not registered");
	}, 30_000);
});
