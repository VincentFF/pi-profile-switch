import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPiFixture, launchInstanceDirs, type PiFixture } from "./helpers/pi-fixture.ts";
import { RpcDriver } from "./helpers/rpc-driver.ts";

const BIN = path.resolve("bin/pi-profile.ts");

let fixture: PiFixture;

beforeEach(async () => {
	fixture = await createPiFixture();
});

afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true });
});

function launcherEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		HOME: fixture.root,
		PI_CODING_AGENT_DIR: fixture.agentDir,
		PI_OFFLINE: "1",
	};
}

async function writeCatalog(profiles: Record<string, unknown>): Promise<void> {
	const dir = path.join(fixture.profileSwitchDir, "profiles");
	await mkdir(dir, { recursive: true });
	for (const [name, definition] of Object.entries(profiles)) {
		await writeFile(path.join(dir, `${name}.json`), JSON.stringify(definition));
	}
}

describe("instance lifecycle", () => {
	it(
		"two concurrent launches of one profile get separate instances that do not write into each other",
		{ timeout: 45_000 },
		async () => {
			await writeCatalog({ impl: {} });

			const first = new RpcDriver("node", [BIN, "impl", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			const second = new RpcDriver("node", [BIN, "impl", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			try {
				const [a, b] = await Promise.all([
					first.send({ type: "get_state" }),
					second.send({ type: "get_state" }),
				]);
				expect(a.success).toBe(true);
				expect(b.success).toBe(true);

				const dirs = await launchInstanceDirs(fixture);
				expect(dirs).toHaveLength(2);

				const pids: number[] = [];
				for (const dir of dirs) {
					expect(existsSync(path.join(dir, "settings.json"))).toBe(true);
					const plan = JSON.parse(await readFile(path.join(dir, "pi-profile.json"), "utf8"));
					expect(plan.profile).toBe("impl");
					pids.push(Number.parseInt(await readFile(path.join(dir, "pid"), "utf8"), 10));
				}
				// Two live launches, not one instance written twice.
				expect(pids[0]).not.toBe(pids[1]);
			} finally {
				await first.close();
				await second.close();
			}
		},
	);

	it(
		"keeps Pi's runtime state in the real agent dir instead of the instance",
		{ timeout: 45_000 },
		async () => {
			await writeCatalog({ impl: {} });

			const rpc = new RpcDriver("node", [BIN, "impl", "--", "--mode", "rpc"], {
				cwd: fixture.cwd,
				env: launcherEnv(),
			});
			try {
				expect((await rpc.send({ type: "get_state" })).success).toBe(true);
			} finally {
				await rpc.close();
				await rpc.waitForExit();
			}

			const [instance] = await launchInstanceDirs(fixture);
			for (const name of ["auth.json", "models-store.json"]) {
				// Pi resolves these under the agent dir; seeded as links, its writes
				// land in the real agent dir and the instance stays reclaimable.
				expect((await lstat(path.join(instance!, name))).isSymbolicLink()).toBe(true);
				expect(existsSync(path.join(fixture.agentDir, name))).toBe(true);
			}
		},
	);
});
