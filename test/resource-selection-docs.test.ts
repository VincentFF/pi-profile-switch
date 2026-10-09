import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFile(path.resolve(file), "utf8");

function localLinks(markdown: string): string[] {
	return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
		.map((match) => match[1]!)
		.filter((target) => !/^[a-z]+:\/\//i.test(target) && !target.startsWith("#"));
}

/** The body of the first matching level-2 section, up to the next one. */
function section(markdown: string, heading: RegExp): string {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => /^##\s/.test(line) && heading.test(line));
	if (start === -1) return "";
	const body: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^##\s/.test(line)) break;
		body.push(line);
	}
	return body.join("\n");
}

function fieldRows(markdown: string): Map<string, string> {
	return new Map([...markdown.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)]
		.map((match) => [match[1]!, match[2]!]));
}

describe("resource-selection documentation", () => {
	it("architecture overview describes the per-kind control and native-base exclusions", async () => {
		const overview = await read("docs/architecture/overview.md");
		expect(overview).toContain("resourceSelection");
		expect(overview).toContain("disabledSkills");
		expect(overview).toContain("disabledExtensions");
		expect(overview).toMatch(/omitted field keeps Pi's native visibility/);
		expect(overview).toMatch(/Declared kind: whitelist/);
	});

	it("architecture overview documents the conditional extension mirror and rejects the superseded additive mechanism", async () => {
		const overview = await read("docs/architecture/overview.md");
		const model = section(overview, /^##\s+Filtering model$/);
		expect(model.length).toBeGreaterThan(0);
		expect(model).toMatch(/conditional symlink/i);
		expect(model).toMatch(/never deleted, adopted, or overwritten/i);
		expect(model).toMatch(/sweep skips the link without traversing/);
		// The default profile's own representation is retained while any generated
		// mirror from the session is removed, and a declared selection is refused
		// only via the same safety check.
		expect(model).toMatch(/default` profile removes only a mirror this session generated/i);
		expect(model).toMatch(/declared selection keeps the restrictive allowlist/i);
		// The superseded additive-directory mechanism must not remain in scope;
		// ordinary default additive wording elsewhere is not banned.
		expect(model).not.toMatch(/directory re-added because the instance's is profile-managed/i);
		expect(model).not.toMatch(/additively because the instance/i);
	});

	it("architecture overview documents the reload-safe failure presentation", async () => {
		const overview = await read("docs/architecture/overview.md");
		expect(overview).toContain("SwitchDeps.reportFailure");
		expect(overview).toMatch(/stderr/);
		expect(overview).toMatch(/stale/);
		expect(overview).toMatch(/before the rollback reload/i);
	});

	it("PRD success criterion 1 links to the resource-reference contract", async () => {
		const prd = await read("docs/prd.md");
		const criteria = section(prd, /^##\s+Success criteria$/);
		expect(criteria.length).toBeGreaterThan(0);
		const firstCriterion = criteria.split("\n").find((line) => /^1\./.test(line.trim())) ?? "";
		expect(firstCriterion).toContain("openspec/specs/resource-reference/spec.md");
		expect(firstCriterion).toMatch(/declared kind is a selection/);
	});

	it("keeps every relative link in the touched documents resolvable", async () => {
		for (const document of [
			"README.md",
			"README.zh-CN.md",
			"docs/prd.md",
			"docs/architecture/overview.md",
		]) {
			const body = await read(document);
			for (const target of localLinks(body)) {
				const resolved = path.resolve(path.dirname(document), target.split("#", 1)[0]!);
				await expect(stat(resolved), `${document} -> ${target}`).resolves.toBeDefined();
			}
		}
	});

	it.each([
		["README.md", /^##\s+Configuration$/],
		["README.zh-CN.md", /^##\s+配置详解$/],
	])("%s documents explicit empty selections in its configuration guide", async (document, heading) => {
		const guidance = section(await read(document), heading);
		expect(guidance.length).toBeGreaterThan(0);
		expect(guidance).toContain('"skills": []');
		expect(guidance).toContain('"extensions": []');
		expect(guidance).toContain("schemas/profiles.schema.json");
	});

	it.each([
		["README.md", /^##\s+Configuration$/],
		["README.zh-CN.md", /^##\s+配置详解$/],
	])("%s configuration covers schema fields regardless of table alignment", async (document, heading) => {
		const schema = JSON.parse(await read("schemas/profiles.schema.json"));
		const fields = fieldRows(section(await read(document), heading));
		for (const field of Object.keys(schema.properties)) {
			expect(fields.has(field), `${document}: missing field ${field}`).toBe(true);
		}
		for (const field of Object.keys(schema.properties.subagents.properties)) {
			expect(fields.has(`subagents.${field}`), `${document}: missing subagent field ${field}`).toBe(true);
		}
		const roleFields = schema.properties.subagents.properties.agentOverrides.additionalProperties.properties;
		for (const field of Object.keys(roleFields)) {
			expect(fields.has(`subagents.agentOverrides.<name>.${field}`), `${document}: missing role field ${field}`).toBe(true);
		}
	});

	it("keeps field types and runnable command examples synchronized between READMEs", async () => {
		const english = await read("README.md");
		const chinese = await read("README.zh-CN.md");
		expect(fieldRows(english)).toEqual(fieldRows(chinese));
		const commands = (markdown: string) => [...markdown.matchAll(/```(?:bash|text)\n([\s\S]*?)\n```/g)]
			.flatMap((match) => match[1]!.split("\n"))
			.map((line) => line.trim())
			.filter((line) => /^(?:npm |pi-profile(?: |$)|\/profile(?: |$))/.test(line));
		expect(commands(english).length).toBeGreaterThan(0);
		expect(commands(english)).toEqual(commands(chinese));
	});
});
