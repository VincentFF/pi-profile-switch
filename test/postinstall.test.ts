/**
 * Starter profile seeding (install time): bin/postinstall.js writes the
 * shipped `examples/ask.json` starter to the profiles dir ONLY
 * when no .json profile exists — never overwriting user data,
 * never failing the install.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installDefaultProfiles } from "../bin/postinstall.js";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "pi-profile-postinstall-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function envFor(dir: string): NodeJS.ProcessEnv {
	return { PI_PROFILE_SWITCH_DIR: dir };
}

describe("installDefaultProfiles", () => {
	it("writes the shipped starter profile when profiles directory is missing", async () => {
		const dir = path.join(root, "switch");

		const result = await installDefaultProfiles({ env: envFor(dir) });

		expect(result.written).toBe(true);
		const written = await readFile(path.join(dir, "profiles", "ask.json"), "utf8");
		const template = await readFile(path.resolve("examples/ask.json"), "utf8");
		expect(written).toBe(template);

		// The seeded profile is the read-only "ask" starter.
		const parsed = JSON.parse(written);
		expect(parsed.tools).toEqual(["read", "grep", "find", "ls"]);
		expect(parsed.skills).toEqual([]);
		expect(parsed.extensions).toEqual([]);
	});

	it("writes starter profile when profiles directory exists but contains no .json files", async () => {
		const dir = path.join(root, "switch");
		await mkdir(path.join(dir, "profiles"), { recursive: true });
		await writeFile(path.join(dir, "profiles", "README.txt"), "some notes");

		const result = await installDefaultProfiles({ env: envFor(dir) });

		expect(result.written).toBe(true);
		expect(await readFile(path.join(dir, "profiles", "ask.json"), "utf8")).toBe(
			await readFile(path.resolve("examples/ask.json"), "utf8"),
		);
	});

	it("never overwrites an existing catalog (directory has at least one .json file)", async () => {
		const dir = path.join(root, "switch");
		await mkdir(path.join(dir, "profiles"), { recursive: true });
		const existingFile = path.join(dir, "profiles", "mine.json");
		await writeFile(existingFile, JSON.stringify({ tools: ["read"] }));

		const result = await installDefaultProfiles({ env: envFor(dir) });

		expect(result.written).toBe(false);
		expect(await readFile(existingFile, "utf8")).toBe(JSON.stringify({ tools: ["read"] }));
	});

	it("is idempotent: a second run writes nothing", async () => {
		const dir = path.join(root, "switch");

		const first = await installDefaultProfiles({ env: envFor(dir) });
		const second = await installDefaultProfiles({ env: envFor(dir) });

		expect(first.written).toBe(true);
		expect(second.written).toBe(false);
	});
});
