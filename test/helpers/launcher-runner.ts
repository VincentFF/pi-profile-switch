import { execFile } from "node:child_process";
import path from "node:path";

import type { PiFixture } from "./pi-fixture.ts";

/** Absolute path to the launcher entrypoint (vitest runs from the repo root). */
export const LAUNCHER_BIN = path.resolve("bin/pi-profile.ts");

/** Environment for a launcher subprocess: every real-Pi side effect stays
 *  inside the fixture (the launcher resolves the real agent dir through pi's
 *  own override), and offline mode keeps model calls from leaking. */
export function launcherEnv(fixture: PiFixture): NodeJS.ProcessEnv {
	return {
		...process.env,
		HOME: fixture.root,
		PI_CODING_AGENT_DIR: fixture.agentDir,
		PI_OFFLINE: "1",
	};
}

export interface LauncherRun {
	code: number;
	stdout: string;
	stderr: string;
}

/** Runs the launcher end-to-end and resolves with its exit code and output.
 *  stdin is closed immediately: pi reads stdin until EOF, so an open pipe
 *  keeps pi (and the launcher) alive past the test timeout. */
export function runLauncher(fixture: PiFixture, args: string[]): Promise<LauncherRun> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			"node",
			[LAUNCHER_BIN, ...args],
			{ cwd: fixture.cwd, env: launcherEnv(fixture) },
			(error, stdout, stderr) => {
				clearTimeout(timer);
				resolve({ code: (error as { code?: number })?.code ?? 0, stdout, stderr });
			},
		);
		child.stdin?.end();
		const timer = setTimeout(
			() => reject(new Error("launcher did not exit after pi reached EOF on stdin")),
			30_000,
		);
		timer.unref();
	});
}
