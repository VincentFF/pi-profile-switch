import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Harness convention guard: integration tests never spawn the launcher
 * directly. Raw spawns reintroduce the stdin-EOF pitfall (pi reads stdin
 * until EOF; an open pipe keeps the launcher alive past the test timeout),
 * which runLauncher in test/helpers/launcher-runner.ts solves exactly once.
 */
describe("launcher-runner convention", () => {
	it("integration tests spawn the launcher only through runLauncher", () => {
		const dir = path.resolve("test");
		const offenders = readdirSync(dir)
			.filter((name) => name.endsWith(".integration.test.ts"))
			.filter((name) => readFileSync(path.join(dir, name), "utf8").includes("execFile("));
		expect(
			offenders,
			"spawn the launcher via runLauncher from test/helpers/launcher-runner.ts — it closes child stdin, without which pi never exits",
		).toEqual([]);
	});
});
