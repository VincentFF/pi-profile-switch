import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFile(path.resolve(file), "utf8");

function localLinks(markdown: string): string[] {
	return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
		.map((match) => match[1]!)
		.filter((target) => !/^[a-z]+:\/\//i.test(target) && !target.startsWith("#"));
}

/** The body of the first level-2 section whose heading matches, up to the next
 *  level-2 heading. Migration assertions are scoped here rather than banning
 *  omission wording across the whole document. */
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
		["README.md", /^##\s+.*Migration/],
		["README.zh-CN.md", /^##\s+.*迁移/],
	])("%s documents explicit empty selections and links the contract", async (document, heading) => {
		const migration = section(await read(document), heading);
		expect(migration.length).toBeGreaterThan(0);
		expect(migration).toContain('"skills": []');
		expect(migration).toContain('"extensions": []');
		expect(migration).toContain("openspec/specs/resource-reference/spec.md");
	});
});
