import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CatalogError, ProfileCatalog } from "../src/profile-catalog.ts";
import { createPiFixture, type PiFixture } from "./helpers/pi-fixture.ts";

let fixture: PiFixture;

beforeEach(async () => {
	fixture = await createPiFixture();
});

afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true });
});

async function writeGlobalProfile(name: string, content: unknown): Promise<string> {
	const dir = path.join(fixture.profileSwitchDir, "profiles");
	await mkdir(dir, { recursive: true });
	const filePath = path.join(dir, `${name}.json`);
	await writeFile(filePath, typeof content === "string" ? content : JSON.stringify(content));
	return filePath;
}

async function writeProjectProfile(name: string, content: unknown): Promise<string> {
	const dir = path.join(fixture.cwd, ".pi", "profiles");
	await mkdir(dir, { recursive: true });
	const filePath = path.join(dir, `${name}.json`);
	await writeFile(filePath, typeof content === "string" ? content : JSON.stringify(content));
	return filePath;
}

const reviewProfile = {
	label: "Review",
	description: "Code review workflow",
	skills: ["code-review", "git-commit"],
	extensions: ["review-guard"],
	mcps: ["github"],
	tools: ["read", "grep"],
	defaultProvider: "openai",
	defaultModel: "gpt-5.4",
	defaultThinkingLevel: "high",
	instructions: "Be picky.",
};

describe("ProfileCatalog (global catalog)", () => {
	it("resolves a named global profile with its definition and global source", async () => {
		await writeGlobalProfile("review", reviewProfile);

		const catalog = await ProfileCatalog.load(fixture.agentDir);
		const resolved = catalog.resolve("review");

		expect(resolved).toEqual({ name: "review", source: "global", definition: reviewProfile });
	});

	it("resolves the built-in default profile even without a catalog directory", async () => {
		const catalog = await ProfileCatalog.load(fixture.agentDir);

		expect(catalog.resolve("default")).toEqual({ name: "default", source: "builtin", definition: {} });
	});

	it("treats a missing catalog directory as an empty catalog", async () => {
		const catalog = await ProfileCatalog.load(fixture.agentDir);

		expect(catalog.resolve("review")).toBeUndefined();
		expect(catalog.list().map((profile) => profile.name)).toEqual(["default"]);
	});

	it("honors PI_PROFILE_SWITCH_DIR override for catalog discovery", async () => {
		const customSwitchDir = path.join(fixture.root, "custom-switch");
		process.env.PI_PROFILE_SWITCH_DIR = customSwitchDir;
		const profilesDir = path.join(customSwitchDir, "profiles");
		await mkdir(profilesDir, { recursive: true });
		await writeFile(path.join(profilesDir, "custom.json"), JSON.stringify({ label: "Custom" }));

		const catalog = await ProfileCatalog.load(fixture.agentDir);
		expect(catalog.resolve("custom")?.definition.label).toBe("Custom");
	});

	it("ignores non-JSON files, subdirectories, and non-.json entries", async () => {
		await writeGlobalProfile("review", reviewProfile);
		const dir = path.join(fixture.profileSwitchDir, "profiles");
		await writeFile(path.join(dir, "README.txt"), "This is ignored");
		await writeFile(path.join(dir, ".DS_Store"), "binary data");
		await mkdir(path.join(dir, "subdir.json"), { recursive: true }); // directory named with .json

		const catalog = await ProfileCatalog.load(fixture.agentDir);
		expect(catalog.list().map((p) => p.name)).toEqual(["default", "review"]);
	});

	it("lists the built-in default first, then named profiles in alphabetical order", async () => {
		await writeGlobalProfile("review", reviewProfile);
		await writeGlobalProfile("implement", { skills: [] });

		const catalog = await ProfileCatalog.load(fixture.agentDir);

		expect(catalog.list().map((profile) => `${profile.name}:${profile.source}`)).toEqual([
			"default:builtin",
			"implement:global",
			"review:global",
		]);
	});

	it("fails loudly on invalid JSON with the offending file path", async () => {
		const filePath = await writeGlobalProfile("bad", "{ not json");

		await expect(ProfileCatalog.load(fixture.agentDir)).rejects.toThrow(
			new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
	});

	it("fails loudly when top-level is not an object with the file path", async () => {
		const filePath = await writeGlobalProfile("array", "[1, 2, 3]");

		await expect(ProfileCatalog.load(fixture.agentDir)).rejects.toThrow(
			new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
	});

	it("fails loudly when a catalog file redefines the built-in default profile", async () => {
		const filePath = await writeGlobalProfile("default", { skills: [] });

		await expect(ProfileCatalog.load(fixture.agentDir)).rejects.toThrow(
			new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
	});

	it("fails loudly when a profile name is invalid with file path and pattern rule", async () => {
		const dir = path.join(fixture.profileSwitchDir, "profiles");
		await mkdir(dir, { recursive: true });
		const filePath = path.join(dir, "我的 profile.json");
		await writeFile(filePath, JSON.stringify({ skills: [] }));

		await expect(ProfileCatalog.load(fixture.agentDir)).rejects.toThrow(
			new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
		await expect(ProfileCatalog.load(fixture.agentDir)).rejects.toThrow(/must match/);
	});

	it("fails loudly when a profile field has the wrong shape with path, name, and field", async () => {
		const filePath = await writeGlobalProfile("review", { skills: "code-review" });

		const errorPromise = ProfileCatalog.load(fixture.agentDir);
		await expect(errorPromise).rejects.toThrow(new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		await expect(errorPromise).rejects.toThrow(/review/);
		await expect(errorPromise).rejects.toThrow(/skills/);
	});

	it("defaults optional fields to absent rather than empty", async () => {
		await writeGlobalProfile("review", { label: "Review" });

		const catalog = await ProfileCatalog.load(fixture.agentDir);
		const resolved = catalog.resolve("review");

		expect(resolved?.definition.skills).toBeUndefined();
		expect(resolved?.definition.mcps).toBeUndefined();
		expect(resolved?.definition.defaultProvider).toBeUndefined();
		expect(resolved?.definition.defaultModel).toBeUndefined();
		expect(resolved?.definition.defaultThinkingLevel).toBeUndefined();
		expect(resolved?.definition.instructions).toBeUndefined();
	});

	describe("project catalog (trusted projects only)", () => {
		it("resolves project-only profiles with project source", async () => {
			await writeGlobalProfile("review", reviewProfile);
			await writeProjectProfile("implement", { skills: ["project-skill"] });

			const catalog = await ProfileCatalog.load(fixture.agentDir, { projectDir: fixture.cwd });

			expect(catalog.resolve("implement")).toEqual({
				name: "implement",
				source: "project",
				definition: { skills: ["project-skill"] },
			});
		});

		it("a same-name project profile fully replaces the global definition", async () => {
			await writeGlobalProfile("review", reviewProfile);
			await writeProjectProfile("review", { description: "Project override" });

			const catalog = await ProfileCatalog.load(fixture.agentDir, { projectDir: fixture.cwd });
			const resolved = catalog.resolve("review");

			// Full replacement: no global fields survive, no merge.
			expect(resolved).toEqual({
				name: "review",
				source: "project",
				definition: { description: "Project override" },
			});
		});

		it("removing the project override immediately reveals the global definition", async () => {
			await writeGlobalProfile("review", reviewProfile);
			const projFile = await writeProjectProfile("review", { description: "Project override" });
			const withOverride = await ProfileCatalog.load(fixture.agentDir, { projectDir: fixture.cwd });
			expect(withOverride.resolve("review")?.source).toBe("project");

			await rm(projFile);
			const afterRemoval = await ProfileCatalog.load(fixture.agentDir, { projectDir: fixture.cwd });

			expect(afterRemoval.resolve("review")).toEqual({
				name: "review",
				source: "global",
				definition: reviewProfile,
			});
		});

		it("without a project dir, project catalogs are not read at all", async () => {
			await writeProjectProfile("implement", { skills: [] });

			const catalog = await ProfileCatalog.load(fixture.agentDir);

			expect(catalog.resolve("implement")).toBeUndefined();
		});

		it("lists each profile once with its effective source, following alphabetical order scenario", async () => {
			// Spec scenario: WHEN global has b.json, a.json, project has c.json
			// THEN list order is default, a, b, c
			await writeGlobalProfile("b", {});
			await writeGlobalProfile("a", {});
			await writeProjectProfile("c", {});

			const catalog = await ProfileCatalog.load(fixture.agentDir, { projectDir: fixture.cwd });

			expect(catalog.list().map((p) => p.name)).toEqual(["default", "a", "b", "c"]);
		});

		it("lists global profiles with project overrides preserving global position, project-only appended", async () => {
			await writeGlobalProfile("review", reviewProfile);
			await writeGlobalProfile("shared", { skills: [] });
			await writeProjectProfile("shared", { tools: ["read"] });
			await writeProjectProfile("implement", {});

			const catalog = await ProfileCatalog.load(fixture.agentDir, { projectDir: fixture.cwd });

			expect(catalog.list().map((profile) => `${profile.name}:${profile.source}`)).toEqual([
				"default:builtin",
				"review:global",
				"shared:project",
				"implement:project",
			]);
		});
	});
});
