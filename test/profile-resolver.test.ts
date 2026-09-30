import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ResolvedProfile } from "../src/profile-catalog.ts";
import { ActivationError, resolveProfile } from "../src/profile-resolver.ts";
import { DiscoveredExtensions, discoverExtensions } from "../src/extension-discovery.ts";
import { loadMergedMcpServers, type MergedMcpResult } from "../src/mcp-config.ts";
import type { SkillEntry } from "../src/skill-registry.ts";
import { createPiFixture, type PiFixture } from "./helpers/pi-fixture.ts";

let fixture: PiFixture;

beforeEach(async () => {
	fixture = await createPiFixture();
});

afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true });
});

function skill(name: string): SkillEntry {
	return {
		name,
		filePath: path.join(fixture.agentDir, "skills", name, "SKILL.md"),
		source: "auto",
		scope: "user",
		origin: "top-level",
	};
}

function profile(name: string, definition: ResolvedProfile["definition"]): ResolvedProfile {
	return { name, source: "global", definition };
}

async function extensionsWith(names: string[] = []): Promise<DiscoveredExtensions> {
	const extensionsDir = path.join(fixture.agentDir, "extensions");
	await mkdir(extensionsDir, { recursive: true });
	for (const name of names) {
		const entry = path.join(extensionsDir, `${name}.ts`);
		await writeFile(entry, "export default function () {}\n");
	}
	return discoverExtensions({ cwd: fixture.cwd, agentDir: fixture.agentDir });
}

describe("resolveProfile", () => {
	it("expands literal and glob skill references against the registry, deduped", async () => {
		const skills = [skill("code-review"), skill("git-commit"), skill("research-web"), skill("research-docs")];

		const plan = await resolveProfile({
			profile: profile("review", { skills: ["code-review", "research-*", "git-commit"] }),
			skills,
			extensions: await extensionsWith(),
		});

		expect(plan.skills.map((entry) => entry.name).sort()).toEqual([
			"code-review",
			"git-commit",
			"research-docs",
			"research-web",
		]);
	});

	it("fails activation when a literal skill name does not exist", async () => {
		await expect(
			resolveProfile({
				profile: profile("review", { skills: ["no-such-skill"] }),
				skills: [skill("code-review")],
				extensions: await extensionsWith(),
			}),
		).rejects.toThrow(/no-such-skill/);
	});

	it("treats a glob with no current matches as empty, not an error", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { skills: ["future-*"] }),
			skills: [skill("code-review")],
			extensions: await extensionsWith(),
		});

		expect(plan.skills).toEqual([]);
	});

	it("resolves multiple declared extensions directly without dependencies", async () => {
		const extensions = await extensionsWith(["review-guard", "audit-log", "unrelated"]);

		const plan = await resolveProfile({
			profile: profile("review", { extensions: ["review-guard", "audit-log"] }),
			skills: [],
			extensions,
		});

		expect(plan.extensions.map((entry) => entry.id).sort()).toEqual(["audit-log", "review-guard"]);
	});

	it("expands extension globs against discovered extensions", async () => {
		const extensions = await extensionsWith(["github-pr", "github-ci", "other"]);

		const plan = await resolveProfile({
			profile: profile("review", { extensions: ["github-*"] }),
			skills: [],
			extensions,
		});

		expect(plan.extensions.map((entry) => entry.id).sort()).toEqual(["github-ci", "github-pr"]);
	});

	it("fails activation when a literal extension is not discovered", async () => {
		await expect(
			resolveProfile({
				profile: profile("review", { extensions: ["ghost"] }),
				skills: [],
				extensions: await extensionsWith(),
			}),
		).rejects.toThrow(/ghost/);
	});

	it("passes literal tool names through and expands tool globs against Pi's built-in tools", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { tools: ["read", "search_issues", "gre*"] }),
			skills: [],
			extensions: await extensionsWith(),
		});

		expect(plan.tools).toEqual(["read", "search_issues", "grep"]);
	});

	it("keeps loose adapter and sibling extension entries distinct for runtime attribution", async () => {
		const extensions = await extensionsWith(["pi-mcp-adapter", "linter"]);
		const adapterEntry = path.join(fixture.agentDir, "extensions", "pi-mcp-adapter.ts");
		const linterEntry = path.join(fixture.agentDir, "extensions", "linter.ts");

		const plan = await resolveProfile({
			profile: profile("lint", { extensions: ["pi-mcp-adapter", "linter"], tools: ["lint_*"] }),
			skills: [],
			extensions,
		});

		expect(plan.extensions).toEqual([
			{ id: "pi-mcp-adapter", entry: adapterEntry },
			{ id: "linter", entry: linterEntry },
		]);
		expect(plan.toolReferences).toEqual(["lint_*"]);
	});

	it("keeps the raw tool references for extension-side expansion", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { tools: ["read", "mcp__*"] }),
			skills: [],
			extensions: await extensionsWith(),
		});

		expect(plan.toolReferences).toEqual(["read", "mcp__*"]);
	});

	it("leaves tools, model, and instructions out of the plan when undeclared", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { skills: ["code-review"] }),
			skills: [skill("code-review")],
			extensions: await extensionsWith(),
		});

		expect(plan.tools).toBeUndefined();
		expect(plan.model).toBeUndefined();
		expect(plan.instructions).toBeUndefined();
	});

	it("carries a declared model after successful validation", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { defaultProvider: "openai", defaultModel: "gpt-5.4", defaultThinkingLevel: "high" }),
			skills: [],
			extensions: await extensionsWith(),
			validateModel: async () => undefined,
		});

		expect(plan.model).toEqual({ provider: "openai", id: "gpt-5.4", thinkingLevel: "high" });
	});

	it("fails activation when the declared model is missing or unauthenticated", async () => {
		await expect(
			resolveProfile({
				profile: profile("review", { defaultProvider: "openai", defaultModel: "gpt-5.4" }),
				skills: [],
				extensions: await extensionsWith(),
				validateModel: async () => "No API key found for \"openai\"",
			}),
		).rejects.toThrow(/No API key found/);
	});

	it("fails activation on an invalid thinking level", async () => {
		await expect(
			resolveProfile({
				profile: profile("review", { defaultProvider: "openai", defaultModel: "gpt-5.4", defaultThinkingLevel: "extreme" }),
				skills: [],
				extensions: await extensionsWith(),
				validateModel: async () => undefined,
			}),
		).rejects.toThrow(/thinkingLevel/);
	});

	it("expands mcp references against the discovered adapter server names", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { mcps: ["github", "internal-*"] }),
			skills: [],
			extensions: await extensionsWith(),
			discoveredMcpServers: ["github", "internal-docs", "internal-ci", "other"],
		});

		expect(plan.mcps).toEqual(["github", "internal-docs", "internal-ci"]);
	});

	it("fails activation on a literal mcp reference the adapter never discovered", async () => {
		await expect(
			resolveProfile({
				profile: profile("review", { mcps: ["github-ro"] }),
				skills: [],
				extensions: await extensionsWith(),
				discoveredMcpServers: ["github"],
			}),
		).rejects.toThrow(/unknown MCP server: "github-ro"/);
	});

	it("fails activation when mcp is declared without adapter server discovery", async () => {
		await expect(
			resolveProfile({
				profile: profile("review", { mcps: ["github"] }),
				skills: [],
				extensions: await extensionsWith(),
			}),
		).rejects.toThrow(/no adapter server discovery/);
	});

	it("carries declared instructions into the plan", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { instructions: "Be picky." }),
			skills: [],
			extensions: await extensionsWith(),
		});

		expect(plan.instructions).toBe("Be picky.");
	});

	describe("empty mcps selection (honor-empty-mcp-allowlist)", () => {
		async function extensionsWithAdapter(): Promise<DiscoveredExtensions> {
			return extensionsWith(["pi-mcp-adapter"]);
		}

		function mockMcpDiscovery(options: {
			servers?: Record<string, Record<string, unknown>>;
			sharedServers?: string[];
			projectServers?: string[];
			serverOwners?: Record<string, "user" | "project">;
			baseConfig?: Record<string, unknown>;
		} = {}): MergedMcpResult {
			const servers = options.servers ?? {
				github: { url: "https://gh" },
				linear: { command: "linear" },
			};
			const sharedServers = new Set(options.sharedServers ?? ["github"]);
			const projectServers = new Set(options.projectServers ?? []);
			const serverOwners: Record<string, "user" | "project"> = options.serverOwners ?? {};
			for (const s of Object.keys(servers)) {
				if (!Object.hasOwn(serverOwners, s)) {
					serverOwners[s] = projectServers.has(s) ? "project" : "user";
				}
			}
			return { servers, sharedServers, projectServers, serverOwners, baseConfig: options.baseConfig };
		}

		it("retains an empty mcps array as an empty selection when the adapter is active", async () => {
			const plan = await resolveProfile({
				profile: profile("review", { extensions: ["pi-mcp-adapter"], mcps: [] }),
				skills: [],
				extensions: await extensionsWithAdapter(),
				mcpDiscovery: mockMcpDiscovery({ servers: { github: { url: "https://gh" } }, sharedServers: ["github"] }),
			});

			expect(plan.mcps).toEqual([]);
			expect(plan.instanceMcpConfig).toEqual({ mcpServers: { github: { disabled: true } } });
		});

		it("leaves an empty mcps array inert when the adapter is not active", async () => {
			const plan = await resolveProfile({
				profile: profile("review", { mcps: [] }),
				skills: [],
				extensions: await extensionsWith(),
			});

			expect(plan.mcps).toBeUndefined();
			expect(plan.instanceMcpConfig).toBeUndefined();
		});

		it("fails activation for empty mcps with active adapter but no MCP discovery", async () => {
			await expect(
				resolveProfile({
					profile: profile("review", { extensions: ["pi-mcp-adapter"], mcps: [] }),
					skills: [],
					extensions: await extensionsWithAdapter(),
				}),
			).rejects.toThrow(/no adapter server discovery/);
		});

		it("retains an empty mcps selection when the adapter discovers no servers", async () => {
			const plan = await resolveProfile({
				profile: profile("review", { extensions: ["pi-mcp-adapter"], mcps: [] }),
				skills: [],
				extensions: await extensionsWithAdapter(),
				mcpDiscovery: mockMcpDiscovery({ servers: {}, sharedServers: [], projectServers: [] }),
			});

			expect(plan.mcps).toEqual([]);
			expect(plan.instanceMcpConfig).toEqual({ mcpServers: {} });
		});

		it("an empty mcps selection disables shared user servers but keeps project servers enabled", async () => {
			const plan = await resolveProfile({
				profile: profile("review", { extensions: ["pi-mcp-adapter"], mcps: [] }),
				skills: [],
				extensions: await extensionsWithAdapter(),
				mcpDiscovery: mockMcpDiscovery({
					servers: { github: { url: "https://gh" }, "proj-srv": { url: "https://proj" } },
					sharedServers: ["github"],
					projectServers: ["proj-srv"],
				}),
			});

			expect(plan.mcps).toEqual([]);
			expect(plan.instanceMcpConfig).toEqual({
				mcpServers: { github: { disabled: true } },
			});
		});
	});
});

describe("overlay application (ticket 06)", () => {
	it("narrows resolved skills by disabledSkills", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { skills: ["code-review", "debug"] }),
			skills: [skill("code-review"), skill("debug")],
			extensions: await extensionsWith(),
			overlay: { disabledSkills: ["debug"] },
		});

		expect(plan.skills.map((entry) => entry.name)).toEqual(["code-review"]);
	});

	it("rejects disabling a skill the profile does not resolve", async () => {
		await expect(
			resolveProfile({
				profile: profile("review", { skills: ["code-review"] }),
				skills: [skill("code-review")],
				extensions: await extensionsWith(),
				overlay: { disabledSkills: ["ghost-skill"] },
			}),
		).rejects.toThrow(/overlay disables unknown skill "ghost-skill"/);
	});

	it("narrows extensions by disabledExtensions", async () => {
		const extensions = await extensionsWith(["linter", "helper"]);

		const plan = await resolveProfile({
			profile: profile("review", { extensions: ["linter", "helper"] }),
			skills: [],
			extensions,
			overlay: { disabledExtensions: ["helper"] },
		});

		expect(plan.extensions.map((entry) => entry.id).sort()).toEqual(["linter"]);
	});

	it("rejects disabling an extension the profile does not resolve", async () => {
		const extensions = await extensionsWith(["linter"]);

		await expect(
			resolveProfile({
				profile: profile("review", { extensions: ["linter"] }),
				skills: [],
				extensions,
				overlay: { disabledExtensions: ["ghost-ext"] },
			}),
		).rejects.toThrow(/overlay disables unknown extension "ghost-ext"/);
	});

	it("narrows mcp servers and tools by disabled entries", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { mcps: ["github", "linear"], tools: ["read", "bash"] }),
			skills: [],
			extensions: await extensionsWith(),
			discoveredMcpServers: ["github", "linear"],
			liveToolNames: ["read", "bash", "grep"],
			overlay: { disabledMcps: ["linear"], disabledTools: ["bash"] },
		});

		expect(plan.mcps).toEqual(["github"]);
		expect(plan.tools).toEqual(["read"]);
		expect(plan.toolReferences).toEqual(["read", "bash"]);
		expect(plan.disabledTools).toEqual(["bash"]);
	});

	it("a tool disable removes a matching tool from the live-registry base on a profile without declared tools", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { skills: ["code-review"] }),
			skills: [skill("code-review")],
			extensions: await extensionsWith(),
			liveToolNames: ["read", "bash", "grep"],
			overlay: { disabledTools: ["bash"] },
		});

		// No declared tools: the plan keeps no tools field; the entries are
		// carried verbatim for session-start application.
		expect(plan.tools).toBeUndefined();
		expect(plan.toolReferences).toBeUndefined();
		expect(plan.disabledTools).toEqual(["bash"]);
	});

	it("rejects disabling a tool the profile does not resolve", async () => {
		await expect(
			resolveProfile({
				profile: profile("review", { skills: ["code-review"], tools: ["read", "bash"] }),
				skills: [skill("code-review")],
				extensions: await extensionsWith(),
				liveToolNames: ["read", "bash"],
				overlay: { disabledTools: ["ghost-tool"] },
			}),
		).rejects.toThrow(/overlay disables unknown tool "ghost-tool"/);
	});

	it("lands a zero-match tool glob disable in unmatched with an overlay prefix instead of failing", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { skills: ["code-review"], tools: ["read", "bash"] }),
			skills: [skill("code-review")],
			extensions: await extensionsWith(),
			liveToolNames: ["read", "bash"],
			overlay: { disabledTools: ["ghost-*"] },
		});

		expect(plan.tools).toEqual(["read", "bash"]);
		expect(plan.disabledTools).toEqual(["ghost-*"]);
		expect(plan.unmatched).toEqual(["overlay tool:ghost-*"]);
	});

	it("narrows tools by a glob disable entry against the declared references", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { tools: ["read", "grep", "find"] }),
			skills: [],
			extensions: await extensionsWith(),
			liveToolNames: ["read", "grep", "find", "ls"],
			overlay: { disabledTools: ["gr*"] },
		});

		expect(plan.tools).toEqual(["read", "find"]);
		expect(plan.toolReferences).toEqual(["read", "grep", "find"]);
		expect(plan.disabledTools).toEqual(["gr*"]);
	});

	it("fails a tool disable when no live tool registry is available", async () => {
		await expect(
			resolveProfile({
				profile: profile("review", { skills: ["code-review"] }),
				skills: [skill("code-review")],
				extensions: await extensionsWith(),
				overlay: { disabledTools: ["bash"] },
			}),
		).rejects.toThrow(/overlay disables tools but no live tool registry is available/);
	});

	it("an undeclared profile with an overlay that disables nothing yields no tools field", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { skills: ["code-review"] }),
			skills: [skill("code-review")],
			extensions: await extensionsWith(),
			liveToolNames: ["read", "bash"],
			overlay: { disabledSkills: ["code-review"] },
		});

		expect(plan.tools).toBeUndefined();
		expect(plan.disabledTools).toBeUndefined();
	});

	it("narrows resolved skills by a glob disable entry", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { skills: ["code-review", "git-commit", "git-rebase"] }),
			skills: [skill("code-review"), skill("git-commit"), skill("git-rebase")],
			extensions: await extensionsWith(),
			overlay: { disabledSkills: ["git-*"] },
		});

		expect(plan.skills.map((entry) => entry.name)).toEqual(["code-review"]);
	});

	it("narrows resolved extensions by a glob disable entry", async () => {
		const extensions = await extensionsWith(["linter", "github-pr", "github-ci"]);

		const plan = await resolveProfile({
			profile: profile("review", { extensions: ["linter", "github-pr", "github-ci"] }),
			skills: [],
			extensions,
			overlay: { disabledExtensions: ["github-*"] },
		});

		expect(plan.extensions.map((entry) => entry.id)).toEqual(["linter"]);
	});

	it("narrows resolved MCP servers by a glob disable entry", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { mcps: ["github", "linear", "linter-docs"] }),
			skills: [],
			extensions: await extensionsWith(),
			discoveredMcpServers: ["github", "linear", "linter-docs"],
			overlay: { disabledMcps: ["linear", "linter-*"] },
		});

		expect(plan.mcps).toEqual(["github"]);
	});

	it("lands a zero-match glob disable in unmatched with an overlay prefix instead of failing", async () => {
		const skills = [skill("code-review")];
		const extensions = await extensionsWith(["linter"]);

		const plan = await resolveProfile({
			profile: profile("review", { skills: ["code-review"], extensions: ["linter"], mcps: ["github"] }),
			skills,
			extensions,
			discoveredMcpServers: ["github"],
			overlay: { disabledSkills: ["ghost-*"], disabledExtensions: ["ghost-*"], disabledMcps: ["ghost-*"] },
		});

		expect(plan.skills.map((entry) => entry.name)).toEqual(["code-review"]);
		expect(plan.extensions.map((entry) => entry.id)).toEqual(["linter"]);
		expect(plan.mcps).toEqual(["github"]);
		expect(plan.unmatched).toEqual([
			"overlay skill:ghost-*",
			"overlay extension:ghost-*",
			"overlay mcp:ghost-*",
		]);
	});

	it("a zero-match MCP glob disable on a profile without declared mcps stays unrestricted and warns", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { skills: ["code-review"] }),
			skills: [skill("code-review")],
			extensions: await extensionsWith(),
			overlay: { disabledMcps: ["ghost-*"] },
		});

		expect(plan.mcps).toBeUndefined();
		expect(plan.unmatched).toEqual(["overlay mcp:ghost-*"]);
	});

	it("a literal MCP disable on a profile without declared mcps still fails identifying the entry", async () => {
		await expect(
			resolveProfile({
				profile: profile("review", { skills: ["code-review"] }),
				skills: [skill("code-review")],
				extensions: await extensionsWith(),
				overlay: { disabledMcps: ["github"] },
			}),
		).rejects.toThrow(/overlay disables unknown MCP server "github"/);
	});

	it("rejects disabling an MCP server the profile does not resolve", async () => {
		await expect(
			resolveProfile({
				profile: profile("review", { mcps: ["github"] }),
				skills: [],
				extensions: await extensionsWith(),
				discoveredMcpServers: ["github"],
				overlay: { disabledMcps: ["ghost-server"] },
			}),
		).rejects.toThrow(/overlay disables unknown MCP server "ghost-server"/);
	});
});

describe("discovery-first extension references (ADR-0007)", () => {
	async function registryWithPackage(name: string): Promise<{ registry: DiscoveredExtensions; entry: string }> {
		const root = path.join(fixture.agentDir, "npm", "node_modules", name);
		await mkdir(root, { recursive: true });
		const entry = path.join(root, "index.ts");
		await writeFile(entry, "export default function () {}\n");
		await writeFile(
			path.join(root, "package.json"),
			JSON.stringify({ name, version: "1.0.0", pi: { extensions: ["./index.ts"] } }),
		);
		// Discovery reads Pi's configured packages, so the package has to be
		// configured in the fixture's settings like a real installation.
		await writeFile(
			path.join(fixture.agentDir, "settings.json"),
			JSON.stringify({ packages: [`npm:${name}`] }),
		);
		const registry = await discoverExtensions({ cwd: fixture.cwd, agentDir: fixture.agentDir });
		return { registry, entry };
	}

	it("a profile references an installed package by name, no registration", async () => {
		const { registry, entry } = await registryWithPackage("pi-mcp-adapter");

		const plan = await resolveProfile({
			profile: profile("review", { extensions: ["pi-mcp-adapter"] }),
			skills: [],
			extensions: registry,
		});

		expect(plan.extensions).toEqual([{ id: "pi-mcp-adapter", entry }]);
	});

	it("a profile references an extension by absolute path", async () => {
		const dir = path.join(fixture.agentDir, "extensions");
		await mkdir(dir, { recursive: true });
		const file = path.join(dir, "one-off.ts");
		await writeFile(file, "export default function () {}\n");

		const plan = await resolveProfile({
			profile: profile("review", { extensions: [file] }),
			skills: [],
			extensions: await extensionsWith(),
		});

		expect(plan.extensions).toEqual([{ id: file, entry: file }]);
	});

	it("unknown extension literals fail with actionable guidance", async () => {
		const { registry } = await registryWithPackage("pi-mcp-adapter");

		const error = await resolveProfile({
			profile: profile("review", { extensions: ["mcp-adapter"] }),
			skills: [],
			extensions: registry,
		}).catch((caught: unknown) => caught);

		expect((error as Error).message).toContain('did you mean "pi-mcp-adapter"');
		expect((error as Error).message).not.toContain("resources.json");
	});

	it("zero-match globs land in plan.unmatched instead of failing silently", async () => {
		const plan = await resolveProfile({
			profile: profile("review", { skills: ["future-*"], extensions: ["ghost-*"] }),
			skills: [skill("code-review")],
			extensions: await extensionsWith(),
		});

		expect(plan.skills).toEqual([]);
		expect(plan.extensions).toEqual([]);
		expect(plan.unmatched).toEqual(["skill:future-*", "extension:ghost-*"]);
	});

	it("overlays disable package-selected extensions by their resolved ID", async () => {
		const { registry, entry } = await registryWithPackage("pi-mcp-adapter");

		const plan = await resolveProfile({
			profile: profile("review", { extensions: ["pi-mcp-adapter"] }),
			skills: [],
			extensions: registry,
			overlay: { disabledExtensions: ["pi-mcp-adapter"] },
		});

		expect(plan.extensions).toEqual([]);
		expect(entry).toContain("pi-mcp-adapter");
	});
});

describe("mcp_tools resolution and server policy (tasks 1.2 & 2.1)", () => {
	function mockMcpDiscovery(options: {
		servers?: Record<string, Record<string, unknown>>;
		sharedServers?: string[];
		projectServers?: string[];
		serverOwners?: Record<string, "user" | "project">;
		baseConfig?: Record<string, unknown>;
	} = {}): MergedMcpResult {
		const servers = options.servers ?? {
			github: { url: "https://gh" },
			linear: { command: "linear" },
		};
		const sharedServers = new Set(options.sharedServers ?? ["github", "linear"]);
		const projectServers = new Set(options.projectServers ?? []);
		const serverOwners: Record<string, "user" | "project"> = options.serverOwners ?? {};
		for (const s of Object.keys(servers)) {
			if (!Object.hasOwn(serverOwners, s)) {
				serverOwners[s] = projectServers.has(s) ? "project" : "user";
			}
		}
		return {
			servers,
			sharedServers,
			projectServers,
			serverOwners,
			baseConfig: options.baseConfig,
		};
	}

	async function extensionsWithAdapter(extra: string[] = []): Promise<DiscoveredExtensions> {
		return extensionsWith(["pi-mcp-adapter", ...extra]);
	}

	it("fails activation when mcp_tools names prototype properties absent from discovered servers", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({ servers: { github: { url: "https://gh" } } });

		for (const serverName of ["toString", "__proto__"]) {
			const definition = JSON.parse(
				`{"extensions":["pi-mcp-adapter"],"mcp_tools":{${JSON.stringify(serverName)}:["search"]}}`,
			);
			await expect(
				resolveProfile({
					profile: profile("review", definition),
					skills: [],
					extensions,
					mcpDiscovery,
				}),
			).rejects.toThrow(`unknown MCP server "${serverName}"`);
		}
	});

	it("rejects configured __proto__ when adapter discovery can only represent toString", async () => {
		const extensions = await extensionsWithAdapter();
		await writeFile(
			path.join(fixture.agentDir, "mcp.json"),
			'{"mcpServers":{"toString":{"url":"https://string"},"__proto__":{"url":"https://proto"}}}',
		);
		const mcpDiscovery = await loadMergedMcpServers(fixture.agentDir, undefined, { homeDir: fixture.root });
		const definition = JSON.parse(
			'{"extensions":["pi-mcp-adapter"],"mcp_tools":{"toString":["search"],"__proto__":["lookup"]}}',
		);

		await expect(
			resolveProfile({
				profile: profile("review", definition),
				skills: [],
				extensions,
				mcpDiscovery,
			}),
		).rejects.toThrow(/unknown MCP server "__proto__".*toString/);
	});

	it("fails activation when mcp_tools names an unknown server, providing usable candidates", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: { github: { url: "https://gh" } },
		});

		await expect(
			resolveProfile({
				profile: profile("review", {
					extensions: ["pi-mcp-adapter"],
					mcp_tools: { typo_server: ["search"] },
				} as any),
				skills: [],
				extensions,
				mcpDiscovery,
			}),
		).rejects.toThrow(/unknown MCP server "typo_server".*github/);
	});

	it("fails activation when mcp_tools names a disabled server, providing usable candidates", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: {
				github: { url: "https://gh" },
				disabled_server: { url: "https://dis", disabled: true },
			},
		});

		await expect(
			resolveProfile({
				profile: profile("review", {
					extensions: ["pi-mcp-adapter"],
					mcp_tools: { disabled_server: ["search"] },
				} as any),
				skills: [],
				extensions,
				mcpDiscovery,
			}),
		).rejects.toThrow(/MCP server "disabled_server" is disabled.*github/);
	});

	it("fails activation when mcp_tools names a server disabled by mcps allowlist", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: {
				github: { url: "https://gh" },
				linear: { command: "linear" },
			},
		});

		await expect(
			resolveProfile({
				profile: profile("review", {
					extensions: ["pi-mcp-adapter"],
					mcps: ["github"],
					mcp_tools: { linear: ["search"] },
				} as any),
				skills: [],
				extensions,
				mcpDiscovery,
			}),
		).rejects.toThrow(/MCP server "linear" is disabled.*github/);
	});

	it("fails activation when mcp_tools names a project-only server", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: {
				github: { url: "https://gh" },
				"proj-srv": { url: "https://proj" },
			},
			projectServers: ["proj-srv"],
		});

		await expect(
			resolveProfile({
				profile: profile("review", {
					extensions: ["pi-mcp-adapter"],
					mcp_tools: { "proj-srv": ["search"] },
				} as any),
				skills: [],
				extensions,
				mcpDiscovery,
			}),
		).rejects.toThrow(/cannot narrow project-level MCP server "proj-srv"/);
	});

	it("fails activation when mcp_tools names a project-shadowed server", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: {
				"shared-shadowed": { url: "https://proj-override" },
			},
			projectServers: ["shared-shadowed"],
			serverOwners: { "shared-shadowed": "project" },
		});

		await expect(
			resolveProfile({
				profile: profile("review", {
					extensions: ["pi-mcp-adapter"],
					mcp_tools: { "shared-shadowed": ["search"] },
				} as any),
				skills: [],
				extensions,
				mcpDiscovery,
			}),
		).rejects.toThrow(/cannot narrow project-level MCP server "shared-shadowed"/);
	});

	it("fails activation when nonempty mcp_tools is declared without active pi-mcp-adapter", async () => {
		const extensions = await extensionsWith(["other-ext"]);
		const mcpDiscovery = mockMcpDiscovery({
			servers: { github: { url: "https://gh" } },
		});

		await expect(
			resolveProfile({
				profile: profile("review", {
					extensions: ["other-ext"],
					mcp_tools: { github: ["search"] },
				} as any),
				skills: [],
				extensions,
				mcpDiscovery,
			}),
		).rejects.toThrow(/pi-mcp-adapter is not active/);
	});

	it("does not require adapter when mcp_tools is empty object or undeclared", async () => {
		const extensions = await extensionsWith([]);
		const plan = await resolveProfile({
			profile: profile("review", {
				mcp_tools: {},
			} as any),
			skills: [],
			extensions,
		});

		expect(plan.mcpTools).toBeUndefined();
		expect(plan.instanceMcpConfig).toBeUndefined();
	});

	it("fails activation before file writes on unsafe existing includeTools / excludeTools", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: {
				github: {
					url: "https://gh",
					includeTools: "not-an-array",
				},
			},
		});

		await expect(
			resolveProfile({
				profile: profile("review", {
					extensions: ["pi-mcp-adapter"],
					mcp_tools: { github: ["search"] },
				} as any),
				skills: [],
				extensions,
				mcpDiscovery,
			}),
		).rejects.toThrow(/unsafe MCP tool filter intersection for server "github"/);
	});

	it("fails safely when profile selectors are not exact members of an existing allowlist", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: {
				github: {
					url: "https://gh",
					includeTools: ["search", "read_*"],
					excludeTools: ["read_secret"],
				},
			},
		});

		await expect(
			resolveProfile({
				profile: profile("review", {
					extensions: ["pi-mcp-adapter"],
					mcp_tools: { github: ["search", "read_docs"] },
				} as any),
				skills: [],
				extensions,
				mcpDiscovery,
			}),
		).rejects.toThrow(/unsafe MCP tool filter intersection for server "github"/);
	});

	it("fails safely when existing selectors collide with a profile selector alias", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: { github: { url: "https://gh", includeTools: ["foo-bar"] } },
		});

		await expect(
			resolveProfile({
				profile: profile("review", {
					extensions: ["pi-mcp-adapter"],
					mcp_tools: { github: ["foo_bar"] },
				} as any),
				skills: [],
				extensions,
				mcpDiscovery,
			}),
		).rejects.toThrow(/unsafe MCP tool filter intersection for server "github".*foo_bar/);
	});

	it("accepts exact selector overlap and preserves existing exclusions", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: { github: { url: "https://gh", includeTools: ["foo-bar"], excludeTools: ["hidden"] } },
		});

		const plan = await resolveProfile({
			profile: profile("review", {
				extensions: ["pi-mcp-adapter"],
				mcp_tools: { github: ["foo-bar"] },
			} as any),
			skills: [],
			extensions,
			mcpDiscovery,
		});

		const server = (plan.instanceMcpConfig?.mcpServers as Record<string, any>).github;
		expect(server.includeTools).toEqual(["foo-bar"]);
		expect(server.excludeTools).toEqual(["hidden"]);
	});

	it("narrows a universal existing includeTools selector to the profile's literal selectors", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: { github: { url: "https://gh", includeTools: ["*"], excludeTools: ["hidden"] } },
		});

		const plan = await resolveProfile({
			profile: profile("review", {
				extensions: ["pi-mcp-adapter"],
				mcp_tools: { github: ["foo_bar"] },
			} as any),
			skills: [],
			extensions,
			mcpDiscovery,
		});

		const server = (plan.instanceMcpConfig?.mcpServers as Record<string, any>).github;
		expect(server.includeTools).toEqual(["foo_bar"]);
		expect(server.excludeTools).toEqual(["hidden"]);
	});

	it("represents an empty tool list as deny-all excludeTools: ['*']", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: { github: { url: "https://gh" } },
		});

		const plan = await resolveProfile({
			profile: profile("review", {
				extensions: ["pi-mcp-adapter"],
				mcp_tools: { github: [] },
			} as any),
			skills: [],
			extensions,
			mcpDiscovery,
		});

		const server = (plan.instanceMcpConfig?.mcpServers as Record<string, any>).github;
		expect(server.excludeTools).toEqual(["*"]);
		expect(server.includeTools).toBeUndefined();
	});

	it("keeps all user-level servers when mcps is omitted and preserves server omitted from mcp_tools", async () => {
		const extensions = await extensionsWithAdapter();
		const mcpDiscovery = mockMcpDiscovery({
			servers: {
				github: { url: "https://gh" },
				linear: { command: "linear", env: { API_KEY: "secret" } },
			},
		});

		const plan = await resolveProfile({
			profile: profile("review", {
				extensions: ["pi-mcp-adapter"],
				mcp_tools: {
					github: ["search"],
				},
			} as any),
			skills: [],
			extensions,
			mcpDiscovery,
		});

		expect(plan.mcps).toBeUndefined();
		const servers = plan.instanceMcpConfig?.mcpServers as Record<string, any>;
		expect(servers.github.includeTools).toEqual(["search"]);
		expect(servers.linear).toEqual({ command: "linear", env: { API_KEY: "secret" } });
	});
});
