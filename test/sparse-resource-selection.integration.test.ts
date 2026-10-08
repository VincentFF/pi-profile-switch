import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { launcherEnv, runLauncherRpc } from "./helpers/launcher-runner.ts";
import { createPiFixture, type PiFixture } from "./helpers/pi-fixture.ts";
import type { RpcDriver } from "./helpers/rpc-driver.ts";

/**
 * Real-Pi coverage for the sparse skill/extension selection contract. Loaded
 * resources are compared against a native session's own observation (the
 * baseline), never against resolver-derived expectations.
 */

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

async function writeUserSettings(settings: unknown): Promise<void> {
	await writeFile(path.join(fixture.agentDir, "settings.json"), JSON.stringify(settings));
}

async function addGlobalSkill(name: string): Promise<void> {
	const dir = path.join(fixture.agentDir, "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
}

async function addAgentsSkill(name: string): Promise<void> {
	const dir = path.join(fixture.root, ".agents", "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
}

async function addProjectSkill(name: string): Promise<void> {
	const dir = path.join(fixture.cwd, ".pi", "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
}

/** An extension that registers a same-named command observed through RPC. */
async function addExtensionFile(name: string): Promise<string> {
	const dir = path.join(fixture.agentDir, "extensions");
	await mkdir(dir, { recursive: true });
	return writeExtensionFile(path.join(dir, `${name}.ts`), name);
}

async function writeExtensionFile(file: string, name: string): Promise<string> {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(
		file,
		[
			`import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";`,
			`export default function (pi: ExtensionAPI) {`,
			`\tpi.registerCommand(${JSON.stringify(name)}, { description: "fixture ${name}", handler: async () => {} });`,
			`}`,
			"",
		].join("\n"),
	);
	return file;
}

async function addProjectExtension(name: string): Promise<string> {
	return writeExtensionFile(path.join(fixture.cwd, ".pi", "extensions", `${name}.ts`), name);
}

/** Reports every registered tool name (including built-ins) so a native
 *  built-in control's effect is observable. */
async function addToolReporter(name: string): Promise<string> {
	const dir = path.join(fixture.agentDir, "extensions");
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, `${name}.ts`);
	await writeFile(
		file,
		[
			`import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";`,
			`export default function (pi: ExtensionAPI) {`,
			`\tpi.registerCommand(${JSON.stringify(name)}, {`,
			`\t\tdescription: "report registered tools",`,
			`\t\thandler: async () => {`,
			`\t\t\tpi.sendMessage({`,
			`\t\t\t\tcustomType: "fixture-tool-report",`,
			`\t\t\t\tcontent: "tools",`,
			`\t\t\t\tdisplay: true,`,
			`\t\t\t\tdetails: { tools: pi.getAllTools().map((tool) => tool.name) },`,
			`\t\t\t});`,
			`\t\t},`,
			`\t});`,
			`}`,
			"",
		].join("\n"),
	);
	return file;
}

interface Observation {
	skills: string[];
	commands: string[];
}

async function observe(args: string[], toolCommand?: string): Promise<Observation & { tools?: string[] }> {
	const rpc = runLauncherRpc(fixture, args, launcherEnv(fixture));
	try {
		await rpc.send({ type: "get_state" });
		const skills = await rpc.skillCommandNames();
		const commands = (await rpc.commandNames()).map((command) => command.name);
		let tools: string[] | undefined;
		if (toolCommand !== undefined) {
			await rpc.send({ type: "prompt", message: `/${toolCommand}` }, 60_000);
			const raw = await rpc.waitFor((message) => extractTools(message) !== undefined, 60_000);
			tools = extractTools(raw);
		}
		return { skills, commands, ...(tools !== undefined ? { tools } : {}) };
	} finally {
		await rpc.close();
	}
}

function extractTools(message: unknown): string[] | undefined {
	const record = message as {
		details?: { tools?: string[] };
		message?: { details?: { tools?: string[] } };
	};
	if (Array.isArray(record.details?.tools)) return record.details.tools;
	if (Array.isArray(record.message?.details?.tools)) return record.message?.details?.tools;
	return undefined;
}

function fixtureCommands(observation: Observation, names: string[]): string[] {
	return names.filter((name) => observation.commands.includes(name)).sort();
}

describe("sparse resource selection against a real spawned pi", () => {
	it(
		"omitted skills preserve every natively visible skill",
		{ timeout: 90_000 },
		async () => {
			await addGlobalSkill("alpha-skill");
			await addGlobalSkill("beta-skill");
			await addAgentsSkill("shared-skill");
			await addExtensionFile("selected-ext");
			await writeCatalog({ review: { extensions: ["selected-ext"] } });

			const baseline = await observe(["--", "--mode", "rpc"]);
			const review = await observe(["review", "--", "--mode", "rpc"]);

			expect(review.skills).toEqual(baseline.skills);
			expect(baseline.skills).toEqual(
				expect.arrayContaining(["skill:alpha-skill", "skill:beta-skill", "skill:shared-skill"]),
			);
			expect(fixtureCommands(review, ["selected-ext"])).toEqual(["selected-ext"]);
		},
	);

	it(
		"omitted extensions preserve extension visibility observed natively",
		{ timeout: 90_000 },
		async () => {
			await addGlobalSkill("alpha-skill");
			await addExtensionFile("ext-a");
			await addExtensionFile("ext-b");
			await writeCatalog({ review: { skills: ["alpha-skill"] } });

			const baseline = await observe(["--", "--mode", "rpc"]);
			const review = await observe(["review", "--", "--mode", "rpc"]);

			expect(fixtureCommands(review, ["ext-a", "ext-b"])).toEqual(fixtureCommands(baseline, ["ext-a", "ext-b"]));
			expect(review.skills).toEqual(["skill:alpha-skill"]);
		},
	);

	it(
		"explicit empty selections remain restrictive for each kind",
		{ timeout: 90_000 },
		async () => {
			await addGlobalSkill("alpha-skill");
			await addAgentsSkill("shared-skill");
			await addExtensionFile("ext-a");
			await writeCatalog({ bare: { skills: [], extensions: [] } });

			const bare = await observe(["bare", "--", "--mode", "rpc"]);

			expect(bare.skills).toEqual([]);
			expect(fixtureCommands(bare, ["ext-a"])).toEqual([]);
		},
	);

	it(
		"a skill-only selection leaves extensions at native visibility",
		{ timeout: 90_000 },
		async () => {
			await addGlobalSkill("alpha-skill");
			await addGlobalSkill("beta-skill");
			await addExtensionFile("ext-a");
			await addExtensionFile("ext-b");
			await writeCatalog({ review: { skills: ["alpha-skill"] } });

			const baseline = await observe(["--", "--mode", "rpc"]);
			const review = await observe(["review", "--", "--mode", "rpc"]);

			expect(review.skills).toEqual(["skill:alpha-skill"]);
			expect(fixtureCommands(review, ["ext-a", "ext-b"])).toEqual(fixtureCommands(baseline, ["ext-a", "ext-b"]));
		},
	);

	it(
		"an extension-only selection leaves skills at native visibility",
		{ timeout: 90_000 },
		async () => {
			await addGlobalSkill("alpha-skill");
			await addGlobalSkill("beta-skill");
			await addExtensionFile("ext-a");
			await addExtensionFile("ext-b");
			await writeCatalog({ review: { extensions: ["ext-a"] } });

			const baseline = await observe(["--", "--mode", "rpc"]);
			const review = await observe(["review", "--", "--mode", "rpc"]);

			expect(review.skills).toEqual(baseline.skills);
			expect(fixtureCommands(review, ["ext-a", "ext-b"])).toEqual(["ext-a"]);
		},
	);

	it(
		"native exclusions and inclusion exceptions stay effective for an omitted and a glob selection",
		{ timeout: 120_000 },
		async () => {
			await addGlobalSkill("kept-skill");
			await addGlobalSkill("hidden-skill");
			await writeUserSettings({ skills: ["!skills/**", "+skills/kept-skill/SKILL.md"] });
			await addExtensionFile("ext-a");
			await writeCatalog({ omitted: { extensions: ["ext-a"] }, globbed: { skills: ["*"], extensions: ["ext-a"] } });

			const omitted = await observe(["omitted", "--", "--mode", "rpc"]);
			const globbed = await observe(["globbed", "--", "--mode", "rpc"]);

			// The native `!skills/**` exclusion hides the agentDir skills; the native
			// `+skills/kept-skill/SKILL.md` force-inclusion keeps the kept skill.
			expect(omitted.skills).toEqual(["skill:kept-skill"]);
			expect(globbed.skills).toEqual(["skill:kept-skill"]);
		},
	);

	it(
		"a settings-only extension path survives an omitted extension field",
		{ timeout: 90_000 },
		async () => {
			const settingsOnly = await writeExtensionFile(path.join(fixture.root, "generated", "one-off.ts"), "one-off");
			await writeUserSettings({ extensions: [settingsOnly] });
			await addGlobalSkill("alpha-skill");
			await writeCatalog({ review: { skills: ["alpha-skill"] } });

			const baseline = await observe(["--", "--mode", "rpc"]);
			const review = await observe(["review", "--", "--mode", "rpc"]);

			expect(fixtureCommands(baseline, ["one-off"])).toEqual(["one-off"]);
			expect(fixtureCommands(review, ["one-off"])).toEqual(["one-off"]);
		},
	);

	it(
		"a native built-in control stays effective under an omitted and a declared extension field",
		{ timeout: 120_000 },
		async () => {
			await addToolReporter("report-tools");
			await writeUserSettings({ extensions: ["-builtin:codemode"] });
			await writeCatalog({ omitted: {}, declared: { extensions: ["report-tools"] } });

			const baseline = await observe(["--", "--mode", "rpc"], "report-tools");
			const omitted = await observe(["omitted", "--", "--mode", "rpc"], "report-tools");

			expect(baseline.tools).not.toContain("codemode");
			expect(omitted.tools).not.toContain("codemode");

			const declared = await observe(["declared", "--", "--mode", "rpc"], "report-tools");
			expect(declared.tools).not.toContain("codemode");
		},
	);

	it(
		"project resources follow the trust boundary for an omitted and an empty selection",
		{ timeout: 120_000 },
		async () => {
			await addGlobalSkill("alpha-skill");
			await addProjectSkill("proj-skill");
			await addProjectExtension("proj-ext");
			await writeCatalog({ omitted: {}, empty: { skills: [] } });

			const untrustedOmitted = await observe(["omitted", "--", "--mode", "rpc"]);
			expect(untrustedOmitted.skills).not.toContain("skill:proj-skill");
			expect(fixtureCommands(untrustedOmitted, ["proj-ext"])).toEqual([]);

			const untrustedEmpty = await observe(["empty", "--", "--mode", "rpc"]);
			expect(untrustedEmpty.skills).not.toContain("skill:proj-skill");

			await writeFile(path.join(fixture.agentDir, "trust.json"), JSON.stringify({ [fixture.cwd]: true }));
			const trustedOmitted = await observe(["omitted", "--", "--mode", "rpc"]);
			expect(trustedOmitted.skills).toContain("skill:proj-skill");
			expect(fixtureCommands(trustedOmitted, ["proj-ext"])).toEqual(["proj-ext"]);

			const trustedEmpty = await observe(["empty", "--", "--mode", "rpc"]);
			expect(trustedEmpty.skills).toContain("skill:proj-skill");
			expect(trustedEmpty.skills).not.toContain("skill:alpha-skill");
		},
	);

	it(
		"the distributed profile-config skill follows the ordinary skill-selection contract",
		{ timeout: 120_000 },
		async () => {
			await addGlobalSkill("alpha-skill");
			await writeCatalog({
				omitted: {},
				empty: { skills: [] },
				unselected: { skills: ["alpha-skill"] },
			});

			const omitted = await observe(["omitted", "--", "--mode", "rpc"]);
			expect(omitted.skills).toContain("skill:profile-config");

			const empty = await observe(["empty", "--", "--mode", "rpc"]);
			expect(empty.skills).not.toContain("skill:profile-config");

			const unselected = await observe(["unselected", "--", "--mode", "rpc"]);
			expect(unselected.skills).not.toContain("skill:profile-config");
			expect(unselected.skills).toEqual(["skill:alpha-skill"]);
		},
	);

	it(
		"a native exclusion hides the distributed profile-config skill",
		{ timeout: 90_000 },
		async () => {
			await writeUserSettings({ skills: ["-skills/profile-config/SKILL.md"] });
			await writeCatalog({ omitted: {} });

			const omitted = await observe(["omitted", "--", "--mode", "rpc"]);
			expect(omitted.skills).not.toContain("skill:profile-config");
		},
	);

	it(
		"a declared selection excludes a skill the native settings only add",
		{ timeout: 90_000 },
		async () => {
			await addGlobalSkill("alpha-skill");
			await addGlobalSkill("beta-skill");
			await writeUserSettings({ skills: ["/opt/pi-resources/extra/SKILL.md"] });
			await writeCatalog({ review: { skills: ["alpha-skill"] } });

			const review = await observe(["review", "--", "--mode", "rpc"]);
			expect(review.skills).toEqual(["skill:alpha-skill"]);
		},
	);
});
