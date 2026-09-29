import { describe, expect, it } from "vitest";

import { buildStatusReport, formatStatusMarkdown } from "../src/switching/status.ts";

const basePlan = {
	profile: "review",
	source: "global",
	resolved: {
		skills: [
			{ name: "code-review", filePath: "/agent/skills/code-review/SKILL.md" },
			{ name: "debug", filePath: "/agent/skills/debug/SKILL.md" },
		],
		extensions: [{ id: "linter", entry: "/agent/extensions/linter.ts" }],
	},
	tools: ["read", "grep"],
	mcps: ["github"],
};

const emptyRuntime = {
	disabledMcpServers: [] as string[],
	commands: [],
	tools: [],
};

describe("buildStatusReport", () => {
	it("reports resolved absolute paths, mcp tri-state, and overlay contents", () => {
		const report = buildStatusReport({
			plan: basePlan,
			overlay: { disabledSkills: ["noisy"] },
			discoveredMcpServers: ["github", "linear"],
			...emptyRuntime,
		});

		expect(report.mcp).toEqual({ enabled: ["github"], disabled: ["linear"], missing: [] });
		expect(report.overlay).toEqual({ disabledSkills: ["noisy"] });
		expect(report.conflicts.map((conflict) => conflict.winnerPath)).toEqual(["not loaded", "not loaded"]);
	});

	it("derives enabled servers from discovery when mcps is undeclared in plan", () => {
		const planWithoutMcps = {
			profile: "default",
			source: "builtin",
			resolved: { skills: [], extensions: [] },
		};
		const report = buildStatusReport({
			plan: planWithoutMcps,
			discoveredMcpServers: ["github", "linear"],
			...emptyRuntime,
		});

		expect(report.mcp).toEqual({ enabled: ["github", "linear"], disabled: [], missing: [] });
	});

	it("respects adapter-disabled servers without an MCP whitelist", () => {
		const planWithoutMcps = {
			profile: "default",
			source: "builtin",
			resolved: { skills: [], extensions: [] },
		};
		const report = buildStatusReport({
			plan: planWithoutMcps,
			discoveredMcpServers: ["github", "linear"],
			disabledMcpServers: ["linear"],
			commands: [],
			tools: [],
		});

		expect(report.mcp).toEqual({ enabled: ["github"], disabled: ["linear"], missing: [] });
		expect(report.mcpTools).toEqual([{ server: "github", policy: "unrestricted" }]);
	});

	it("distinguishes omitted servers (unrestricted) and empty tool lists (none)", () => {
		const plan = {
			...basePlan,
			mcps: ["github", "linear"],
			mcpTools: { linear: [] },
		};
		const report = buildStatusReport({
			plan,
			discoveredMcpServers: ["github", "linear"],
			...emptyRuntime,
		});

		expect(report.mcpTools).toEqual([
			{ server: "github", policy: "unrestricted" },
			{ server: "linear", policy: "none", tools: [] },
		]);
		const markdown = formatStatusMarkdown(report);
		expect(markdown).toContain("github: unrestricted");
		expect(markdown).toContain("linear: no enabled MCP tools");
		expect(markdown).not.toMatch(/validation|tool.*missing|did you mean/i);
	});

	it("reports declared MCP names without validating them", () => {
		const report = buildStatusReport({
			plan: { ...basePlan, mcpTools: { github: ["serach"] } },
			discoveredMcpServers: ["github"],
			...emptyRuntime,
		});

		expect(report.mcpTools).toEqual([{ server: "github", policy: "restricted", tools: ["serach"] }]);
		expect(formatStatusMarkdown(report)).toContain("github: [serach]");
		expect(formatStatusMarkdown(report)).not.toMatch(/validation|tool.*missing|did you mean/i);
	});

	it("reports the glob delta versus the previous activation", () => {
		const report = buildStatusReport({
			plan: {
				...basePlan,
				previousResolved: {
					skills: ["code-review", "old-skill"],
					extensions: ["linter"],
					tools: ["read", "bash"],
					mcps: [],
				},
			},
			discoveredMcpServers: ["github"],
			...emptyRuntime,
		});

		expect(report.delta?.added).toContain("skill:debug");
		expect(report.delta?.added).toContain("mcp:github");
		expect(report.delta?.removed).toEqual(["skill:old-skill", "tool:bash"]);
	});

	it("reports same-name conflicts with Pi's actual winner, never blocking", () => {
		const report = buildStatusReport({
			plan: basePlan,
			discoveredMcpServers: [],
			...emptyRuntime,
			commands: [
				{ name: "skill:code-review", sourceInfo: { path: "/agent/skills/code-review/SKILL.md" } },
				{ name: "skill:debug", sourceInfo: { path: "/project/.pi/skills/debug/SKILL.md" } },
			],
		});

		expect(report.conflicts).toEqual([
			{
				name: "skill:debug",
				expectedPath: "/agent/skills/debug/SKILL.md",
				winnerPath: "/project/.pi/skills/debug/SKILL.md",
			},
		]);
	});

	it("flags resolved skills that never registered as not loaded", () => {
		const report = buildStatusReport({ plan: basePlan, discoveredMcpServers: [], ...emptyRuntime });
		expect(report.conflicts.map((conflict) => conflict.winnerPath)).toEqual(["not loaded", "not loaded"]);
	});

	it("reports tool conflicts only when the winner is neither builtin nor a selected extension", () => {
		const tools = [
			{ name: "read", sourceInfo: { path: "<builtin:read>", source: "builtin" } },
			{ name: "grep", sourceInfo: { path: "/other/extensions/sneaky.ts", source: "extension" } },
		];
		const report = buildStatusReport({ plan: basePlan, discoveredMcpServers: [], disabledMcpServers: [], commands: [], tools });

		expect(report.conflicts).toEqual([
			{ name: "skill:code-review", expectedPath: "/agent/skills/code-review/SKILL.md", winnerPath: "not loaded" },
			{ name: "skill:debug", expectedPath: "/agent/skills/debug/SKILL.md", winnerPath: "not loaded" },
			{ name: "tool:grep", expectedPath: "builtin or selected extension", winnerPath: "/other/extensions/sneaky.ts" },
		]);

		const withExtensionTool = buildStatusReport({
			plan: { ...basePlan, tools: ["lint-fix"] },
			discoveredMcpServers: [],
			disabledMcpServers: [],
			commands: [],
			tools: [{ name: "lint-fix", sourceInfo: { path: "/agent/extensions/linter.ts", source: "extension" } }],
		});
		expect(withExtensionTool.conflicts.map((conflict) => conflict.name)).toEqual(["skill:code-review", "skill:debug"]);
	});
});

describe("formatStatusMarkdown", () => {
	it("renders all sections readably", () => {
		const report = buildStatusReport({
			plan: basePlan,
			overlay: { disabledSkills: ["noisy"], disabledTools: ["bash", "mcp-*"] },
			discoveredMcpServers: ["github", "linear"],
			...emptyRuntime,
		});

		const markdown = formatStatusMarkdown(report);
		expect(markdown).toContain("profile: review (global)");
		expect(markdown).toContain("overlay: -skill:noisy -tool:bash -tool:mcp-*");
		expect(markdown).toContain("code-review → /agent/skills/code-review/SKILL.md");
		expect(markdown).toContain("mcp: enabled=[github] disabled=[linear]");
	});
});
