import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyLaunchPlan, type PlanApplicationSurface } from "../src/switching/apply-plan.ts";

let root: string;
let runtimeDir: string;
let agentDir: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "pi-profile-apply-"));
	runtimeDir = path.join(root, "runtime");
	agentDir = path.join(root, "agent");
	await import("node:fs/promises").then((fs) => fs.mkdir(runtimeDir, { recursive: true }));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function writePlan(plan: unknown): Promise<void> {
	await writeFile(path.join(runtimeDir, "pi-profile.json"), JSON.stringify(plan));
}

interface FakeTool {
	name: string;
	sourceInfo?: { path?: string; source?: string };
}

interface FakeSurface extends PlanApplicationSurface {
	activeTools: string[];
	notifications: Array<{ message: string; level: string }>;
}

function fakeSurface(overrides?: { liveTools?: Array<string | FakeTool> }): FakeSurface {
	const notifications: Array<{ message: string; level: string }> = [];
	const surface: FakeSurface = {
		activeTools: [],
		notifications,
		getAllTools: () =>
			(overrides?.liveTools ?? ["read", "bash", "grep"]).map((t) =>
				typeof t === "string" ? { name: t } : t,
			),
		setActiveTools(names) {
			surface.activeTools = names;
		},
		notify(message, level) {
			notifications.push({ message, level });
		},
	};
	return surface;
}

describe("applyLaunchPlan", () => {
	it("expands tool references against the live registry, including extension tools", async () => {
		await writePlan({ profile: "review", source: "global", tools: ["read"], toolReferences: ["read", "lint*"] });
		const surface = fakeSurface({
			liveTools: [
				{ name: "read", sourceInfo: { path: "<builtin:read>", source: "builtin" } },
				{ name: "bash", sourceInfo: { path: "<builtin:bash>", source: "builtin" } },
				{ name: "lint_check", sourceInfo: { path: "/agent/extensions/linter.ts", source: "extension" } },
			],
		});

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual(["read", "lint_check"]);
	});

	it("does not keep a sibling extension tool when a loose adapter entry is selected with tools empty", async () => {
		await writePlan({
			profile: "no-pi-tools",
			source: "global",
			tools: [],
			toolReferences: [],
			resolved: {
				skills: [],
				extensions: [
					{ id: "pi-mcp-adapter", entry: "/agent/extensions/pi-mcp-adapter.ts" },
					{ id: "linter", entry: "/agent/extensions/linter.ts" },
				],
			},
		});
		const surface = fakeSurface({
			liveTools: [
				{ name: "mcp", sourceInfo: { path: "/agent/extensions/pi-mcp-adapter.ts", source: "extension" } },
				{ name: "lint_check", sourceInfo: { path: "/agent/extensions/linter.ts", source: "extension" } },
				{ name: "adapter_helper_tool", sourceInfo: { path: "/agent/extensions/pi-mcp-adapter-helper.ts", source: "extension" } },
			],
		});

		const result = await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual(["mcp"]);
		expect(result.warnings).toEqual([]);
	});

	it("does not classify nested loose-adapter siblings or project ancestor paths as MCP-owned", async () => {
		const adapterEntry = "/agent/extensions/pi-mcp-adapter/index.ts";
		const nestedSibling = "/agent/extensions/pi-mcp-adapter/linter.ts";
		const projectTool = "/workspace/pi-mcp-adapter/.pi/extensions/project-linter.ts";
		await writePlan({
			profile: "no-pi-tools",
			source: "global",
			tools: [],
			toolReferences: [],
			resolved: {
				skills: [],
				extensions: [
					{ id: "pi-mcp-adapter", entry: adapterEntry, origin: "local" },
					{ id: "pi-mcp-adapter/linter", entry: nestedSibling, origin: "local" },
					{ id: "project-linter", entry: projectTool, origin: "local" },
				],
			},
		});
		const surface = fakeSurface({
			liveTools: [
				{ name: "mcp_allowed", sourceInfo: { path: adapterEntry, source: "extension" } },
				{ name: "lint_check", sourceInfo: { path: nestedSibling, source: "extension" } },
				{ name: "project_check", sourceInfo: { path: projectTool, source: "extension" } },
			],
		});

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual(["mcp_allowed"]);
	});

	it("retains tools from a verified adapter npm package and expands sibling extension globs", async () => {
		const packageRoot = path.join(agentDir, "npm", "node_modules", "pi-mcp-adapter");
		const adapterEntry = path.join(packageRoot, "index.ts");
		const helperEntry = path.join(packageRoot, "src", "tools.ts");
		await mkdir(path.dirname(helperEntry), { recursive: true });
		await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "pi-mcp-adapter" }));
		await writeFile(adapterEntry, "export default function () {}\\n");
		await writeFile(helperEntry, "export const registerTools = true;\\n");
		await writePlan({
			profile: "lint",
			source: "global",
			toolReferences: ["lint_*"],
			resolved: {
				skills: [],
				extensions: [
					{ id: "pi-mcp-adapter", entry: adapterEntry, origin: "package" },
					{ id: "linter", entry: "/agent/extensions/linter.ts", origin: "local" },
				],
			},
		});
		const surface = fakeSurface({
			liveTools: [
				{ name: "mcp", sourceInfo: { path: adapterEntry, source: "extension" } },
				{ name: "mcp_helper", sourceInfo: { path: helperEntry, source: "extension" } },
				{ name: "lint_check", sourceInfo: { path: "/agent/extensions/linter.ts", source: "extension" } },
			],
		});

		const result = await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual(["lint_check", "mcp", "mcp_helper"]);
		expect(result.warnings).toEqual([]);
	});

	it("reapplies tool overlays without treating loose adapter siblings as MCP", async () => {
		await writePlan({
			profile: "lint",
			source: "global",
			toolReferences: ["lint_check"],
			disabledTools: ["lint_check"],
			resolved: {
				skills: [],
				extensions: [
					{ id: "pi-mcp-adapter", entry: "/agent/extensions/pi-mcp-adapter.ts" },
					{ id: "linter", entry: "/agent/extensions/linter.ts" },
				],
			},
		});
		const surface = fakeSurface({
			liveTools: [
				{ name: "mcp", sourceInfo: { path: "/agent/extensions/pi-mcp-adapter.ts", source: "extension" } },
				{ name: "lint_check", sourceInfo: { path: "/agent/extensions/linter.ts", source: "extension" } },
			],
		});

		const first = await applyLaunchPlan({ runtimeDir, cwd: root, reason: "startup", surface });
		expect(surface.activeTools).toEqual(["mcp"]);
		expect(first.warnings).toEqual([]);
		surface.activeTools = [];
		const afterReload = await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });
		expect(surface.activeTools).toEqual(["mcp"]);
		expect(afterReload.warnings).toEqual([]);
	});

	it("retains MCP-owned tools when tools narrows Pi tools to read-only", async () => {
		await writePlan({
			profile: "review",
			source: "global",
			tools: ["read"],
			toolReferences: ["read"],
			resolved: {
				skills: [],
				extensions: [{ id: "pi-mcp-adapter", entry: "/agent/extensions/pi-mcp-adapter/index.ts" }],
			},
		});
		const surface = fakeSurface({
			liveTools: [
				{ name: "read", sourceInfo: { path: "<builtin:read>", source: "builtin" } },
				{ name: "bash", sourceInfo: { path: "<builtin:bash>", source: "builtin" } },
				{ name: "mcp", sourceInfo: { path: "/agent/extensions/pi-mcp-adapter/index.ts", source: "extension" } },
				{ name: "search", sourceInfo: { path: "/agent/extensions/pi-mcp-adapter/index.ts", source: "extension" } },
			],
		});

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		// Builtin 'read' is selected by tools, 'bash' is excluded, but MCP gateway 'mcp' and 'search' are retained!
		expect(surface.activeTools).toEqual(["read", "mcp", "search"]);
	});

	it("warns about legacy MCP references and directs user to mcp_tools", async () => {
		await writePlan({
			profile: "review",
			source: "global",
			tools: ["read", "mcp__*"],
			toolReferences: ["read", "mcp__*", "mcp_direct"],
			resolved: {
				skills: [],
				extensions: [{ id: "pi-mcp-adapter", entry: "/agent/extensions/pi-mcp-adapter/index.ts" }],
			},
		});
		const surface = fakeSurface({
			liveTools: [
				{ name: "read", sourceInfo: { path: "<builtin:read>", source: "builtin" } },
				{ name: "mcp__search", sourceInfo: { path: "/agent/extensions/pi-mcp-adapter/index.ts", source: "extension" } },
				{ name: "mcp_direct", sourceInfo: { path: "/agent/extensions/pi-mcp-adapter/index.ts", source: "extension" } },
			],
		});

		const result = await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		// MCP tools are retained via registration ownership, not via toolReferences
		expect(surface.activeTools).toEqual(["read", "mcp__search", "mcp_direct"]);
		// Legacy references receive actionable migration guidance naming mcp_tools
		expect(result.warnings.some((w) => w.includes("mcp__*") && w.includes("mcp_tools"))).toBe(true);
		expect(result.warnings.some((w) => w.includes("mcp_direct") && w.includes("mcp_tools"))).toBe(true);
	});

	it("respects winning registration sourceInfo on name collision", async () => {
		// When non-MCP wins a name, tools selects it without legacy MCP warning
		await writePlan({ profile: "test", source: "global", tools: ["search"], toolReferences: ["search"] });
		const surfaceNonMcp = fakeSurface({
			liveTools: [
				{ name: "search", sourceInfo: { path: "/agent/extensions/local-search.ts", source: "extension" } },
			],
		});
		const resultNonMcp = await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface: surfaceNonMcp });
		expect(surfaceNonMcp.activeTools).toEqual(["search"]);
		expect(resultNonMcp.warnings).toEqual([]);

		// When MCP wins the name, tools does NOT select it as a Pi tool and warns with migration guidance
		await writePlan({
			profile: "test",
			source: "global",
			tools: ["search"],
			toolReferences: ["search"],
			resolved: {
				skills: [],
				extensions: [{ id: "pi-mcp-adapter", entry: "/agent/extensions/pi-mcp-adapter/index.ts" }],
			},
		});
		const surfaceMcp = fakeSurface({
			liveTools: [
				{ name: "search", sourceInfo: { path: "/agent/extensions/pi-mcp-adapter/index.ts", source: "extension" } },
			],
		});
		const resultMcp = await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface: surfaceMcp });
		expect(surfaceMcp.activeTools).toEqual(["search"]); // retained as MCP tool
		expect(resultMcp.warnings.some((w) => w.includes("search") && w.includes("mcp_tools"))).toBe(true);
	});

	it("empty tools denies all Pi tools while retaining MCP tools", async () => {
		await writePlan({
			profile: "no-pi-tools",
			source: "global",
			tools: [],
			toolReferences: [],
			resolved: {
				skills: [],
				extensions: [{ id: "pi-mcp-adapter", entry: "/agent/extensions/pi-mcp-adapter/index.ts" }],
			},
		});
		const surface = fakeSurface({
			liveTools: [
				{ name: "read", sourceInfo: { path: "<builtin:read>", source: "builtin" } },
				{ name: "mcp", sourceInfo: { path: "/agent/extensions/pi-mcp-adapter/index.ts", source: "extension" } },
			],
		});

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual(["mcp"]);
	});

	it("does not call setActiveTools when tools is undeclared and no overlay, even if mcpTools is present", async () => {
		await writePlan({
			profile: "default",
			source: "builtin",
			mcpTools: { github: ["search"] },
		});
		const surface = fakeSurface({
			liveTools: [
				{ name: "read", sourceInfo: { path: "<builtin:read>", source: "builtin" } },
				{ name: "mcp", sourceInfo: { path: "/agent/extensions/pi-mcp-adapter/index.ts", source: "extension" } },
			],
		});

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		// setActiveTools was never called; activeTools remains empty
		expect(surface.activeTools).toEqual([]);
	});

	it("keeps unknown MCP names in the plan without tool-name warnings", async () => {
		await writePlan({
			profile: "github-restricted",
			source: "global",
			mcpTools: { github: ["serach"] },
		});
		const surface = fakeSurface();

		const result = await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(result.warnings).toEqual([]);
	});

	it("subtracts the overlay's disabled tool entries from the base expansion at session start", async () => {
		await writePlan({
			profile: "review",
			source: "global",
			tools: ["read", "grep"],
			toolReferences: ["read", "bash", "grep"],
			disabledTools: ["bash"],
		});
		const surface = fakeSurface();

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual(["read", "grep"]);
	});

	it("narrows the live registry at session start when the plan carries disabled tool entries without tool references", async () => {
		await writePlan({ profile: "default", source: "builtin", disabledTools: ["grep"] });
		const surface = fakeSurface();

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual(["read", "bash"]);
	});

	it("keeps disabled tools disabled across reload: a glob entry re-expands against the live registry", async () => {
		await writePlan({ profile: "default", source: "builtin", disabledTools: ["gr*"] });
		const surface = fakeSurface({ liveTools: ["read", "bash", "grep", "graphene"] });

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual(["read", "bash"]);
	});

	it("warns about a disabled tool entry the live registry no longer provides", async () => {
		await writePlan({ profile: "default", source: "builtin", disabledTools: ["vanished"] });
		const surface = fakeSurface();

		const result = await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual(["read", "bash", "grep"]);
		expect(result.warnings.some((warning) => warning.includes("vanished"))).toBe(true);
	});

	it("warns about literal tools no live tool provides instead of dropping them silently", async () => {
		await writePlan({ profile: "review", source: "global", tools: ["read"], toolReferences: ["read", "ghost-tool"] });
		const surface = fakeSurface();

		const result = await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual(["read"]);
		expect(result.warnings.some((warning) => warning.includes("ghost-tool"))).toBe(true);
	});

	it("leaves tools untouched when the plan declares none", async () => {
		await writePlan({ profile: "default", source: "builtin" });
		const surface = fakeSurface();

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual([]);
	});

	it("persists the selection to the global state file on reload", async () => {
		await writePlan({ profile: "impl", source: "global", agentDir, persistSelection: true });
		const surface = fakeSurface();

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		const state = JSON.parse(await readFile(path.join(agentDir, "pi-profile-state.json"), "utf8"));
		expect(state).toEqual({ activeProfile: "impl" });
	});

	it("persists project-sourced profiles to the project state file", async () => {
		await writePlan({ profile: "impl", source: "project", agentDir, persistSelection: true });
		const surface = fakeSurface();

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		const projectState = JSON.parse(await readFile(path.join(root, ".pi", "pi-profile-state.json"), "utf8"));
		expect(projectState.activeProfile).toBe("impl");
	});

	it("never writes state for launch-transient selections or at startup", async () => {
		await writePlan({ profile: "impl", source: "global", agentDir });
		const surface = fakeSurface();
		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		await writePlan({ profile: "impl", source: "global", agentDir, persistSelection: true });
		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "startup", surface });

		const { existsSync } = await import("node:fs");
		expect(existsSync(path.join(agentDir, "pi-profile-state.json"))).toBe(false);
	});

	it("returns a one-shot change summary and clears the marker", async () => {
		await writePlan({ profile: "impl", source: "global", agentDir, switchedFrom: "review", tools: ["read"] });
		const surface = fakeSurface();

		const result = await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(result.summary).toContain("review → impl");
		expect(result.summary).toContain("tools: [read]");
		expect(surface.notifications.some((entry) => entry.message.includes("review → impl"))).toBe(true);
		const rewritten = JSON.parse(await readFile(path.join(runtimeDir, "pi-profile.json"), "utf8"));
		expect(rewritten.switchedFrom).toBeUndefined();
	});
});
