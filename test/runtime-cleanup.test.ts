import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NO_PID_GRACE_MS, sweepStaleInstances } from "../src/launcher/runtime-cleanup.ts";
import { createPiFixture, type PiFixture } from "./helpers/pi-fixture.ts";

let fixture: PiFixture;

beforeEach(async () => {
	fixture = await createPiFixture();
});

afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true });
});

function instancesRoot(): string {
	return path.join(fixture.profileSwitchDir, "instances");
}

async function makeInstanceDir(
	name: string,
	options: { pid?: number; mtimeAgeMs?: number } = {},
): Promise<string> {
	const dir = path.join(instancesRoot(), name);
	await mkdir(dir, { recursive: true });
	if (options.pid !== undefined) {
		await writeFile(path.join(dir, "pid"), String(options.pid));
	}
	if (options.mtimeAgeMs !== undefined) {
		const past = new Date(Date.now() - options.mtimeAgeMs);
		await utimes(dir, past, past);
	}
	return dir;
}

/** Spawns a child that exits immediately and returns its (now dead) pid. */
async function deadPid(): Promise<number> {
	const child = spawn(process.execPath, ["-e", ""]);
	await new Promise<void>((resolve) => child.on("exit", () => resolve()));
	if (child.pid === undefined) throw new Error("child pid missing");
	return child.pid;
}

describe("sweepStaleInstances", () => {
	it("reclaims an instance dir whose pid is dead", async () => {
		const stale = await makeInstanceDir("launch-dead", { pid: await deadPid() });

		const warnings = await sweepStaleInstances();

		expect(existsSync(stale)).toBe(false);
		expect(warnings).toEqual([]);
	});

	it("keeps an instance dir whose pid is alive", async () => {
		const live = await makeInstanceDir("launch-live", { pid: process.pid });

		await sweepStaleInstances();

		expect(existsSync(live)).toBe(true);
	});

	it("reclaims an instance dir without a pid file once past the grace window", async () => {
		const old = await makeInstanceDir("launch-old", { mtimeAgeMs: NO_PID_GRACE_MS + 60_000 });

		await sweepStaleInstances();

		expect(existsSync(old)).toBe(false);
	});

	it("keeps an instance dir without a pid file inside the grace window (concurrent-launch race)", async () => {
		const fresh = await makeInstanceDir("launch-fresh");

		await sweepStaleInstances();

		expect(existsSync(fresh)).toBe(true);
	});

	it("reclaims an instance dir whose pid file is unparseable once past the grace window", async () => {
		// Write the pid file before backdating: writing into a dir refreshes its mtime.
		const dir = path.join(instancesRoot(), "launch-garbage");
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "pid"), "not-a-pid");
		const past = new Date(Date.now() - NO_PID_GRACE_MS - 60_000);
		await utimes(dir, past, past);

		await sweepStaleInstances();

		expect(existsSync(dir)).toBe(false);
	});

	it("resolves to no warnings when the instances root does not exist", async () => {
		await expect(sweepStaleInstances()).resolves.toEqual([]);
	});

	it("ignores entries that are not launch dirs", async () => {
		const keep = await makeInstanceDir(path.join("impl", "agent"), { pid: await deadPid() });
		const other = await makeInstanceDir("notes", { pid: await deadPid() });

		const warnings = await sweepStaleInstances();

		expect(existsSync(keep)).toBe(true);
		expect(existsSync(other)).toBe(true);
		expect(warnings).toEqual([]);
	});

	it("keeps an instance dir holding state pi-profile did not generate, and warns", async () => {
		const dir = await makeInstanceDir("launch-wild", { pid: await deadPid() });
		await writeFile(path.join(dir, "settings.json"), "{}");
		await mkdir(path.join(dir, "missions", "projects"), { recursive: true });

		const warnings = await sweepStaleInstances();

		expect(existsSync(dir)).toBe(true);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain(dir);
		expect(warnings[0]).toContain("missions");
	});

	it("reports state written inside a managed directory", async () => {
		const dir = await makeInstanceDir("launch-managed", { pid: await deadPid() });
		await mkdir(path.join(dir, "extensions", "subagent"), { recursive: true });
		await writeFile(path.join(dir, "extensions", "subagent", "config.json"), "{}");

		const warnings = await sweepStaleInstances();

		expect(existsSync(dir)).toBe(true);
		// The unrecognized entry is reported at the boundary of what pi-profile
		// generated, not per file inside it.
		expect(warnings[0]).toContain(path.join("extensions", "subagent"));
	});

	it("keeps an instance-local real directory even when the real agent dir has the same name", async () => {
		// Regression: the seed creates <agentDir>/missions, so a comparison
		// against the real agent dir would declare this dir deletable.
		await mkdir(path.join(fixture.agentDir, "missions"), { recursive: true });
		const dir = await makeInstanceDir("launch-local", { pid: await deadPid() });
		await mkdir(path.join(dir, "missions"), { recursive: true });

		const warnings = await sweepStaleInstances();

		expect(existsSync(dir)).toBe(true);
		expect(warnings).toHaveLength(1);
	});

	it.skipIf(process.getuid?.() === 0)("keeps a dir it cannot inspect and still reclaims the others", async () => {
		const unreadable = await makeInstanceDir("launch-unreadable", {
			mtimeAgeMs: NO_PID_GRACE_MS + 60_000,
		});
		const dead = await makeInstanceDir("launch-other-dead", { pid: await deadPid() });
		await chmod(unreadable, 0o000);

		try {
			const warnings = await sweepStaleInstances();

			expect(existsSync(unreadable)).toBe(true);
			expect(existsSync(dead)).toBe(false);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain(unreadable);
		} finally {
			await chmod(unreadable, 0o700);
		}
	});
});
