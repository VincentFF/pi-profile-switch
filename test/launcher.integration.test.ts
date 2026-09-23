import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addGlobalExtension, addGlobalSkill, createPiFixture, listFiles, type PiFixture } from "./helpers/pi-fixture.ts";
import { RpcDriver } from "./helpers/rpc-driver.ts";
const BIN = path.resolve("bin/pi-profile.ts");
let fixture: PiFixture;
beforeEach(async () => {
	fixture = await createPiFixture();
	await addGlobalSkill(fixture, "alpha-skill");
	await addGlobalSkill(fixture, "beta-skill");
	await addGlobalExtension(fixture, "fixture-ext-cmd");
});
afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true });
});
function launcherEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		HOME: fixture.root,
		// The launcher resolves the real agent dir through pi's own override,
		// keeping every real-pi side effect inside the fixture.
		PI_CODING_AGENT_DIR: fixture.agentDir,
		PI_OFFLINE: "1",
	};
}
describe("launcher integration: real pi subprocess, default profile", () => {
	it(
		"starts the default profile exposing all fixture resources, and leaves the real agent dir untouched",
		{ timeout: 45_000 },
		async () => {
			const userSettings = { customKey: "keep-me" };
			await writeFile(path.join(fixture.agentDir, "settings.json"), JSON.stringify(userSettings));
			const agentDirBefore = await listFiles(fixture.agentDir);
			const rpc = new RpcDriver("node", [BIN, "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			try {
				const commands = await rpc.commandNames();
				const names = commands.map((command) => command.name);
				expect(names).toContain("skill:alpha-skill");
				expect(names).toContain("skill:beta-skill");
				// The fixture extension's command proves its code loaded.
				expect(commands.some((command) => command.name === "fixture-ext-cmd" && command.source === "extension")).toBe(
					true,
				);
			} finally {
				await rpc.close();
			}
			// User's real settings are never rewritten.
			expect(JSON.parse(await readFile(path.join(fixture.agentDir, "settings.json"), "utf8"))).toEqual(userSettings);
			// New files in the real agent dir stay inside pi-profile-owned runtime
			// dirs, Pi's own session storage, the state paths pi-profile seeds
			// so that Pi writes them there instead of into the instance
			// (ADR-0010), and the profile-config skill the launcher distributes on
			// startup (spec: 分发 profile-config skill) — nothing else appears.
			const agentDirAfter = await listFiles(fixture.agentDir);
			const created = agentDirAfter.filter((file) => !agentDirBefore.includes(file));
			for (const file of created) {
				const relative = path.relative(fixture.agentDir, file);
				expect(
					["sessions", "missions", "auth.json", "models-store.json", `skills${path.sep}profile-config`].some(
						(seed) => relative === seed || relative.startsWith(`${seed}${path.sep}`),
					),
				).toBe(true);
			}
			// If session files were created, verify they are placed inside project subdirectories,
			// never directly under sessions/
			const sessionFiles = await listFiles(path.join(fixture.agentDir, "sessions"));
			for (const file of sessionFiles) {
				const rel = path.relative(path.join(fixture.agentDir, "sessions"), file);
				expect(rel.includes(path.sep)).toBe(true);
			}
			// Launcher selection is transient: no runtime state file anywhere.
			const files = await listFiles(fixture.root);
			expect(files.filter((file) => file.endsWith("pi-profile-state.json"))).toEqual([]);
		},
	);
	it(
		"forwards arbitrary pi flags verbatim (pi itself reports the unknown flag)",
		{ timeout: 45_000 },
		async () => {
			// pi prints its own "Unknown option" error and then continues into
			// interactive mode; with stdin at EOF it exits. The point here: the
			// flag reaches pi — pi-profile never rejects it with a whitelist error.
			const output = await new Promise<{ code: number | null; text: string }>((resolve, reject) => {
				const child = execFile(
					"node",
					[BIN, "--", "--definitely-not-a-pi-flag"],
					{ cwd: fixture.cwd, env: launcherEnv() },
					(error, stdout, stderr) => {
						resolve({ code: error ? ((error as { code?: number }).code ?? 0) : 0, text: `${stdout}\n${stderr}` });
					},
				);
				child.stdin?.end();
				setTimeout(() => reject(new Error("launcher did not exit after pi reached EOF on stdin")), 30_000);
			});
			expect(output.text).toContain("Unknown option: --definitely-not-a-pi-flag");
			expect(output.text).not.toContain("unsupported pi argument");
		},
	);
	it(
		"rejects an unknown profile name before spawning pi",
		{ timeout: 30_000 },
		async () => {
			const failure = await new Promise<{ code: number; stderr: string }>((resolve) => {
				execFile(
					"node",
					[BIN, "review", "--", "--mode", "rpc"],
					{ cwd: fixture.cwd, env: launcherEnv() },
					(error, _stdout, stderr) => {
						resolve({ code: (error as { code?: number })?.code ?? 0, stderr });
					},
				);
			});
			expect(failure.code).toBe(2);
			expect(failure.stderr).toContain("unknown profile: review");
		},
	);
});
describe("launcher integration: instance dir cleanup", () => {
	function instancesRoot(): string {
		return path.join(fixture.profileSwitchDir, "instances");
	}
	async function instanceDirNames(): Promise<string[]> {
		try {
			return (await readdir(instancesRoot())).filter((entry) => entry.startsWith("launch-")).sort();
		} catch {
			return [];
		}
	}
	/** Spawns a child that exits immediately and returns its (now dead) pid. */
	async function deadPid(): Promise<number> {
		const child = spawn(process.execPath, ["-e", ""]);
		await new Promise((resolve) => child.on("exit", resolve));
		if (child.pid === undefined) throw new Error("child pid missing");
		return child.pid;
	}
	it(
		"sweeps a pre-seeded stale instance dir (dead pid) at startup",
		{ timeout: 45_000 },
		async () => {
			const stale = path.join(instancesRoot(), "launch-staleTest");
			await mkdir(stale, { recursive: true });
			await writeFile(path.join(stale, "pid"), String(await deadPid()));
			const rpc = new RpcDriver("node", [BIN, "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			try {
				await rpc.commandNames();
				expect(existsSync(stale)).toBe(false);
				// Only this launch's own instance dir remains.
				const names = await instanceDirNames();
				expect(names).toHaveLength(1);
				expect(existsSync(path.join(instancesRoot(), names[0]!, "settings.json"))).toBe(true);
			} finally {
				await rpc.close();
				await rpc.waitForExit();
			}
		},
	);
	it(
		"converges across launches: the previous dir is reclaimed or explicitly reported, never silently dropped",
		{ timeout: 90_000 },
		async () => {
			const first = new RpcDriver("node", [BIN, "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			try {
				await first.commandNames();
			} finally {
				await first.close();
				await first.waitForExit();
			}
			const before = await instanceDirNames();
			expect(before).toHaveLength(1);
			const previousName = before[0]!;
			const previousPath = path.join(instancesRoot(), previousName);
			// The launched process is gone; its pid may however have been recycled
			// by then (pid reuse keeps the dir one round longer by design), so pin
			// a known-dead pid to make the convergence assertion deterministic.
			await writeFile(path.join(previousPath, "pid"), String(await deadPid()));
			const second = new RpcDriver("node", [BIN, "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			try {
				await second.commandNames();
				const afterSecond = await instanceDirNames();
				const stderr = second.stderr.join("");
				// This launch always gets its own dir, never a reused one.
				expect(afterSecond.filter((name) => !before.includes(name))).toHaveLength(1);
				// A previous dir is only kept when it holds state pi-profile did not
				// generate (a leftover lock dir, or state from another package). The
				// runtime state Pi resolves under the agent dir is seeded instead, so
				// the expected outcome is reclamation. Either way the outcome is
				// explicit: reclaimed, or reported on stderr.
				if (existsSync(previousPath)) {
					expect(stderr).toContain(`${previousPath} was not reclaimed`);
					expect(afterSecond).toHaveLength(2);
				} else {
					expect(stderr).not.toContain(previousPath);
					expect(afterSecond).toHaveLength(1);
				}
			} finally {
				await second.close();
				await second.waitForExit();
			}
		},
	);
	it(
		"keeps a stale dir whose unrecognized entry references the instance path, and warns",
		{ timeout: 45_000 },
		async () => {
			const stale = path.join(instancesRoot(), "launch-pathRef");
			await mkdir(stale, { recursive: true });
			await writeFile(path.join(stale, "pid"), String(await deadPid()));
			// A ledger-style record embedding its own instance path must survive
			// untouched (ADR-0010 protection, ADR-0012 scan gate).
			await writeFile(
				path.join(stale, "ledger.json"),
				JSON.stringify({ recordPath: path.join(stale, "ledger.json") }),
			);
			const rpc = new RpcDriver("node", [BIN, "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			try {
				await rpc.commandNames();
				expect(existsSync(stale)).toBe(true);
				expect(existsSync(path.join(stale, "ledger.json"))).toBe(true);
				expect(existsSync(path.join(fixture.agentDir, "ledger.json"))).toBe(false);
				const stderr = rpc.stderr.join("");
				expect(stderr).toContain(`${stale} was not reclaimed`);
				expect(stderr).toContain("ledger.json");
			} finally {
				await rpc.close();
				await rpc.waitForExit();
			}
		},
	);
	it(
		"adopts an unrecognized entry with no path references into the real agent dir, then reclaims the dir",
		{ timeout: 45_000 },
		async () => {
			const stale = path.join(instancesRoot(), "launch-adopt");
			await mkdir(stale, { recursive: true });
			await writeFile(path.join(stale, "pid"), String(await deadPid()));
			await writeFile(path.join(stale, "mcp-cache.json"), JSON.stringify({ cache: "portable" }));
			const rpc = new RpcDriver("node", [BIN, "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			try {
				await rpc.commandNames();
				expect(existsSync(stale)).toBe(false);
				expect(JSON.parse(await readFile(path.join(fixture.agentDir, "mcp-cache.json"), "utf8"))).toEqual({
					cache: "portable",
				});
				const stderr = rpc.stderr.join("");
				expect(stderr).toContain("pi-profile: notice:");
				expect(stderr).toContain("adopted mcp-cache.json");
			} finally {
				await rpc.close();
				await rpc.waitForExit();
			}
		},
	);
	it(
		"deletes the instance copy on a name conflict with the real agent dir (real wins), with a notice",
		{ timeout: 45_000 },
		async () => {
			await writeFile(path.join(fixture.agentDir, "custom-state.json"), JSON.stringify({ real: true }));
			const stale = path.join(instancesRoot(), "launch-conflict");
			await mkdir(stale, { recursive: true });
			await writeFile(path.join(stale, "pid"), String(await deadPid()));
			await writeFile(path.join(stale, "custom-state.json"), JSON.stringify({ instance: true }));
			const rpc = new RpcDriver("node", [BIN, "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			try {
				await rpc.commandNames();
				expect(existsSync(stale)).toBe(false);
				// Real wins: the real agent dir's copy is untouched, no comparison.
				expect(JSON.parse(await readFile(path.join(fixture.agentDir, "custom-state.json"), "utf8"))).toEqual({
					real: true,
				});
				const stderr = rpc.stderr.join("");
				expect(stderr).toContain("pi-profile: notice:");
				expect(stderr).toContain("deleted custom-state.json");
			} finally {
				await rpc.close();
				await rpc.waitForExit();
			}
		},
	);
	it(
		"only warns for unrecognized entries inside the managed extensions/ dir",
		{ timeout: 45_000 },
		async () => {
			const stale = path.join(instancesRoot(), "launch-extWarn");
			await mkdir(path.join(stale, "extensions", "some-ext"), { recursive: true });
			await writeFile(path.join(stale, "pid"), String(await deadPid()));
			await writeFile(path.join(stale, "extensions", "some-ext", "config.json"), "{}");
			const rpc = new RpcDriver("node", [BIN, "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			try {
				await rpc.commandNames();
				expect(existsSync(stale)).toBe(true);
				expect(existsSync(path.join(stale, "extensions", "some-ext", "config.json"))).toBe(true);
				expect(existsSync(path.join(fixture.agentDir, "extensions", "some-ext"))).toBe(false);
				const stderr = rpc.stderr.join("");
				expect(stderr).toContain(`${stale} was not reclaimed`);
				expect(stderr).toContain("some-ext");
				expect(stderr).not.toContain("pi-profile: notice:");
			} finally {
				await rpc.close();
				await rpc.waitForExit();
			}
		},
	);
});
describe("launcher integration: starter assets ensure", () => {
	it(
		"seeds starter profile ask and makes it resolvable on first launch",
		{ timeout: 45_000 },
		async () => {
			const profilesDir = path.join(fixture.profileSwitchDir, "profiles");
			expect(existsSync(path.join(profilesDir, "ask.json"))).toBe(false);
			const rpc = new RpcDriver("node", [BIN, "ask", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			try {
				const commands = await rpc.commandNames();
				expect(commands.length).toBeGreaterThan(0);
				expect(existsSync(path.join(profilesDir, "ask.json"))).toBe(true);
				expect(existsSync(path.join(fixture.agentDir, "skills", "profile-config", "SKILL.md"))).toBe(true);
			} finally {
				await rpc.close();
				await rpc.waitForExit();
			}
		},
	);
});
