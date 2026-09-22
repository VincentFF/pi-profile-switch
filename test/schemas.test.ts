/**
 * The shipped JSON schemas validate the shipped examples, and the
 * validator agrees with the runtime parsers on the loadable surface
 * (schema-valid files parse; the parser's rejections are schema-invalid).
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020Module from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { ProfileCatalog } from "../src/profile-catalog.ts";
import { createPiFixture } from "./helpers/pi-fixture.ts";

const Ajv2020 = Ajv2020Module.default;

// ajv/dist/2020: draft 2020-12 support (propertyNames + const).
// Fresh instance per use — compile() registers $id and refuses duplicates.
const newAjv = () => new Ajv2020({ strict: true });

async function loadSchema(name: string) {
	return JSON.parse(await readFile(path.resolve("schemas", name), "utf8"));
}

describe("shipped JSON schemas", () => {
	it("profiles schema validates the shipped install-time starter", async () => {
		const profiles = await loadSchema("profiles.schema.json");
		const starter = JSON.parse(await readFile(path.resolve("examples/ask.json"), "utf8"));

		const ajv = newAjv();
		expect(ajv.validate(profiles, starter), JSON.stringify(ajv.errors)).toBe(true);
	});

	it("profiles schema validates the shipped complete example", async () => {
		const profiles = await loadSchema("profiles.schema.json");
		const example = JSON.parse(await readFile(path.resolve("examples/example.json"), "utf8"));

		const ajv = newAjv();
		expect(ajv.validate(profiles, example), JSON.stringify(ajv.errors)).toBe(true);
	});

	it("the profiles schema rejects inheritance keys and wrong types", async () => {
		const validate = newAjv().compile(await loadSchema("profiles.schema.json"));

		expect(validate({ extends: "base" })).toBe(false);
		expect(validate({ skills: "oops" })).toBe(false);
		expect(validate({ defaultProvider: 123 })).toBe(false);
	});

	it("schema-valid catalogs load through the runtime parsers", async () => {
		const fixture = await createPiFixture();
		try {
			const profilesDir = path.join(fixture.profileSwitchDir, "profiles");
			await mkdir(profilesDir, { recursive: true });
			await writeFile(
				path.join(profilesDir, "impl.json"),
				await readFile(path.resolve("examples/example.json"), "utf8"),
			);
			const catalog = await ProfileCatalog.load(fixture.agentDir);
			expect(catalog.resolve("impl")?.definition.label).toBe("Implementation");
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});
});
