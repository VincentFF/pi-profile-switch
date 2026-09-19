import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

interface FakeSurface extends PlanApplicationSurface {
	activeTools: string[];
	notifications: Array<{ message: string; level: string }>;
}

function fakeSurface(overrides?: { liveTools?: string[] }): FakeSurface {
	const notifications: Array<{ message: string; level: string }> = [];
	const surface: FakeSurface = {
		activeTools: [],
		notifications,
		getAllTools: () => (overrides?.liveTools ?? ["read", "bash", "grep"]).map((name) => ({ name })),
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
		await writePlan({ profile: "review", source: "global", tools: ["read"], toolReferences: ["read", "mcp__*"] });
		const surface = fakeSurface({ liveTools: ["read", "bash", "mcp__github__search"] });

		await applyLaunchPlan({ runtimeDir, cwd: root, reason: "reload", surface });

		expect(surface.activeTools).toEqual(["read", "mcp__github__search"]);
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
