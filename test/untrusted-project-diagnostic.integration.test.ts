import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPiFixture, type PiFixture } from "./helpers/pi-fixture.ts";

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

function runLauncher(args: string[]): Promise<{ code: number; stderr: string }> {
	return new Promise((resolve) => {
		const child = execFile(
			"node",
			[BIN, ...args],
			{ cwd: fixture.cwd, env: launcherEnv() },
			(error, _stdout, stderr) => resolve({ code: (error as { code?: number })?.code ?? 0, stderr }),
		);
		// pi in print mode reads stdin until EOF; without this the open pipe
		// keeps pi (and the launcher) alive past the test timeout.
		child.stdin?.end();
	});
}

async function writeGlobalCatalog(profiles: Record<string, unknown>): Promise<void> {
	const dir = path.join(fixture.profileSwitchDir, "profiles");
	await mkdir(dir, { recursive: true });
	for (const [name, definition] of Object.entries(profiles)) {
		await writeFile(path.join(dir, `${name}.json`), JSON.stringify(definition));
	}
}

describe("launcher untrusted-project diagnostic", () => {
	it(
		"reports skipped content and authorization steps for default and named profiles",
		{ timeout: 45_000 },
		async () => {
			await mkdir(path.join(fixture.cwd, ".pi", "profiles"), { recursive: true });
			await mkdir(path.join(fixture.cwd, ".pi", "extensions"), { recursive: true });
			await writeGlobalCatalog({ review: { skills: [] } });

			const defaultLaunch = await runLauncher(["--", "--mode", "print"]);
			const namedLaunch = await runLauncher(["review", "--", "--mode", "print"]);

			for (const result of [defaultLaunch, namedLaunch]) {
				expect(result.code).toBe(0);
				expect(result.stderr).toContain("project is untrusted");
				expect(result.stderr).toContain(".pi/profiles");
				expect(result.stderr).toContain(".pi/extensions");
				expect(result.stderr).toContain("invisible");
				expect(result.stderr).toContain("/trust");
				expect(result.stderr).toContain("next launch");
				expect(result.stderr).toContain("-- --approve");
				expect(result.stderr.match(/project is untrusted/g)).toHaveLength(1);
			}
		},
	);

	it(
		"does not report the diagnostic for a trusted project",
		{ timeout: 45_000 },
		async () => {
			await writeFile(path.join(fixture.cwd, ".pi", "settings.json"), "{}");
			await writeFile(path.join(fixture.agentDir, "trust.json"), JSON.stringify({ [fixture.cwd]: true }));

			const result = await runLauncher(["--", "--mode", "print"]);

			expect(result.code).toBe(0);
			expect(result.stderr).not.toContain("project is untrusted");
		},
	);

	it(
		"does not report the diagnostic for an empty project forced untrusted with --no-approve",
		{ timeout: 45_000 },
		async () => {
			const result = await runLauncher(["--", "--mode", "print", "--no-approve"]);

			expect(result.code).toBe(0);
			expect(result.stderr).not.toContain("project is untrusted");
		},
	);
});
