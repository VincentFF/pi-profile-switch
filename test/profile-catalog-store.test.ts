import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CatalogError, ProfileCatalog } from "../src/profile-catalog.ts";
import { ProfileCatalogStore } from "../src/profile-catalog-store.ts";
import { createPiFixture, type PiFixture } from "./helpers/pi-fixture.ts";

let fixture: PiFixture;

beforeEach(async () => {
	fixture = await createPiFixture();
});

afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true });
});

const store = () => new ProfileCatalogStore(path.join(fixture.profileSwitchDir, "profiles"));

describe("ProfileCatalogStore", () => {
	it("upserts a self-contained definition into a new file, loadable by ProfileCatalog", async () => {
		await store().upsert("review", {
			label: "Code review",
			skills: ["review*"],
			extensions: ["linter"],
			mcps: ["github"],
			defaultProvider: "deepseek",
			defaultModel: "deepseek-v4-pro",
			defaultThinkingLevel: "high",
			instructions: "Be terse.",
		});

		const filePath = path.join(fixture.profileSwitchDir, "profiles", "review.json");
		const raw = JSON.parse(await readFile(filePath, "utf8"));
		expect(raw).toEqual({
			label: "Code review",
			skills: ["review*"],
			extensions: ["linter"],
			mcps: ["github"],
			defaultProvider: "deepseek",
			defaultModel: "deepseek-v4-pro",
			defaultThinkingLevel: "high",
			instructions: "Be terse.",
		});
		// No schemaVersion envelope
		expect(raw.schemaVersion).toBeUndefined();
		expect(raw.profiles).toBeUndefined();

		const catalog = await ProfileCatalog.load(fixture.agentDir);
		expect(catalog.resolve("review")?.definition.label).toBe("Code review");
	});

	it("writes back only declared fields — unknown keys do not survive a save", async () => {
		await store().upsert("review", { label: "ok" });
		await store().upsert("review", { skills: ["a"] });

		const catalog = await ProfileCatalog.load(fixture.agentDir);
		expect(catalog.resolve("review")?.definition).toEqual({ skills: ["a"] });
	});

	it("rejects the built-in name and malformed definitions loudly", async () => {
		await expect(store().upsert("default", {})).rejects.toThrow(CatalogError);
		await expect(store().upsert("review", { skills: "oops" as never })).rejects.toThrow(CatalogError);
		await expect(store().upsert(" ", {})).rejects.toThrow(CatalogError);
	});

	it("rejects illegal profile names and explains naming rules", async () => {
		await expect(store().upsert("foo bar", {})).rejects.toThrow(/invalid profile name "foo bar"/);
		await expect(store().upsert("foo bar", {})).rejects.toThrow(/must match/);
		await expect(store().upsert(".hidden", {})).rejects.toThrow(/invalid profile name/);
	});

	it("does not touch the disk on illegal definition (definition validation before write)", async () => {
		const targetFile = path.join(fixture.profileSwitchDir, "profiles", "invalid-profile.json");
		await expect(store().upsert("invalid-profile", { skills: 123 as never })).rejects.toThrow(CatalogError);

		await expect(access(targetFile)).rejects.toThrow();
	});

	it("drops inheritance fields — the editor has no inheritance concept", async () => {
		// Unknown keys (extends, merge, ...) are not part of the definition
		// model: they cannot survive a save, so no profile can inherit.
		await store().upsert("review", { label: "x", extends: "base" } as never);

		const catalog = await ProfileCatalog.load(fixture.agentDir);
		expect(catalog.resolve("review")?.definition).toEqual({ label: "x" });
	});

	it("remove deletes the profile and is loud about unknown names", async () => {
		await store().upsert("review", {});
		await store().remove("review");

		expect((await ProfileCatalog.load(fixture.agentDir)).resolve("review")).toBeUndefined();
		await expect(store().remove("review")).rejects.toThrow(CatalogError);
	});

	it("remove rejects illegal names and directory traversal attempts, leaving disk untouched", async () => {
		// Create a file outside the profiles directory to ensure remove doesn't delete it
		const parentFile = path.join(fixture.profileSwitchDir, "escape.json");
		await writeFile(parentFile, JSON.stringify({ label: "outside" }));

		await expect(store().remove("../escape")).rejects.toThrow(/invalid profile name "\.\.\/escape"/);
		await expect(store().remove("../escape")).rejects.toThrow(/must match/);
		await expect(store().remove("")).rejects.toThrow(CatalogError);
		await expect(store().remove("foo bar")).rejects.toThrow(CatalogError);

		// The file outside the directory is untouched
		expect(await readFile(parentFile, "utf8")).toBe(JSON.stringify({ label: "outside" }));
	});

	it("saves never block on external concurrent edits across different profiles", async () => {
		await store().upsert("review", { label: "mine" });
		// Another process creates external.json in the same profiles directory
		const dir = path.join(fixture.profileSwitchDir, "profiles");
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "external.json"), JSON.stringify({ description: "theirs" }));

		await store().upsert("review", { label: "updated" });
		const catalog = await ProfileCatalog.load(fixture.agentDir);
		expect(catalog.resolve("review")?.definition.label).toBe("updated");
		expect(catalog.resolve("external")?.definition.description).toBe("theirs");
	});
});
