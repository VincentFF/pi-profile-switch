/**
 * InstanceCleanup: sweeps stale per-launch instance directories at startup.
 *
 * Every launch materializes its own instance dir under
 * `<PI_PROFILE_SWITCH_DIR>/instances/launch-*` (ADR-0010), which would
 * otherwise accumulate forever. Startup sweep is the ONLY cleanup mechanism by
 * design: any exit — graceful, signal, SIGKILL, power loss — kills the child
 * pid, so the next launch's sweep converges. There is no exit-time deletion; it
 * would only buy immediacy at the cost of deletion logic on the signal path.
 *
 * Liveness token: a `pid` file written by spawnPi into the instance dir.
 * (Naming the dir after the pid is impossible — the pid does not exist before
 * spawn, and the running process's PI_CODING_AGENT_DIR path is frozen.) Rules
 * per instance dir:
 * - pid file parses and the process is alive (or EPERM) → keep;
 *   ESRCH → candidate.
 * - no/unparsable pid file → candidate only when the dir mtime is older than
 *   NO_PID_GRACE_MS. The grace window guards the concurrent-launch race (a
 *   second launcher between mkdir and its pid write must not be reaped); it
 *   also covers post-mkdir crashes.
 * PID reuse needs no /proc check: a wrong keep only delays cleanup and
 * self-heals once the reused pid dies.
 *
 * A candidate is deleted only when every entry in it is pi-profile's own: a
 * symlink (the mirror's link into the real agent dir) or a managed generated
 * file. Anything else is state an extension created at runtime, so the
 * directory is kept and reported — the sweep never destroys data it cannot
 * attribute. The check deliberately does NOT consult the real agent dir: a
 * same-named entry there (a seeded `missions`, say) must not turn an
 * instance-local real directory into a deletable one.
 *
 * Everything is best-effort: sweep errors never block a launch.
 */

import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { MANAGED_INSTANCE_FILES } from "../settings-generator.ts";
import { getInstancesRootDir } from "../workspace.ts";

/** Prefix of the directories this module owns under the instances root. */
const INSTANCE_DIR_PREFIX = "launch-";

/** Grace period for instance dirs without a (parseable) pid file. */
export const NO_PID_GRACE_MS = 10 * 60 * 1000;

/** Managed directories whose contents are not necessarily generated: a package
 *  may write its own files inside them (e.g. an extension's own config). */
const MANAGED_DIRS_WITH_RUNTIME_CONTENT = new Set(["extensions"]);

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but is not signal-able by us: keep.
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

/** Paths inside `dir` that pi-profile did not generate, relative to `dir`.
 *  `undefined` means the directory could not be inspected — the caller must
 *  treat that as unrecognized rather than as empty. */
async function unrecognizedEntries(dir: string): Promise<string[] | undefined> {
	let entries: Dirent<string>[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return undefined;
	}

	const found: string[] = [];
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		let linkStat;
		try {
			linkStat = await lstat(entryPath);
		} catch {
			continue; // Vanished under us: nothing to protect.
		}
		// Symlinks only point at the real agent dir and hold no data of their own.
		if (linkStat.isSymbolicLink()) continue;
		if (!MANAGED_INSTANCE_FILES.has(entry.name)) {
			found.push(entry.name);
			continue;
		}
		if (MANAGED_DIRS_WITH_RUNTIME_CONTENT.has(entry.name) && linkStat.isDirectory()) {
			const nested = await unrecognizedEntries(entryPath);
			if (nested === undefined) {
				found.push(entry.name);
				continue;
			}
			found.push(...nested.map((name) => path.join(entry.name, name)));
		}
	}
	return found;
}

/** Reclaims `dir` if it is both dead and free of unrecognized entries.
 *  Returns the warnings for the cases where it was intentionally kept. */
async function sweepEntry(dir: string): Promise<string[]> {
	let pid: number | undefined;
	try {
		const raw = await readFile(path.join(dir, "pid"), "utf8");
		const parsed = Number.parseInt(raw.trim(), 10);
		if (Number.isInteger(parsed) && parsed > 0) pid = parsed;
	} catch {
		// No pid file (or unreadable): fall through to the mtime guard.
	}

	if (pid !== undefined) {
		if (isProcessAlive(pid)) return [];
	} else {
		const info = await stat(dir);
		if (Date.now() - info.mtimeMs <= NO_PID_GRACE_MS) return [];
	}

	const unrecognized = await unrecognizedEntries(dir);
	if (unrecognized === undefined) {
		return [
			`${dir} was not reclaimed: it could not be inspected (permissions?). Check its contents and delete it manually.`,
		];
	}
	if (unrecognized.length > 0) {
		return [
			`${dir} was not reclaimed: it holds state pi-profile did not generate (${unrecognized.join(", ")}). ` +
				`Move that state into the real agent dir (it is mirrored on the next launch), or point the extension that ` +
				`created it at a fixed path via that extension's own configuration, then delete ${dir}.`,
		];
	}

	await rm(dir, { recursive: true, force: true });
	return [];
}

/** Deletes stale instance dirs under the instances root and returns the
 *  warnings for directories it deliberately kept. Never throws. */
export async function sweepStaleInstances(): Promise<string[]> {
	const warnings: string[] = [];
	const root = getInstancesRootDir();

	let entries: string[];
	try {
		entries = await readdir(root);
	} catch {
		return warnings; // No instances root yet: nothing to sweep.
	}

	for (const entry of entries) {
		// Only directories this module generated are candidates. Anything else
		// under the root — 0.4.x's per-profile dirs included — is not ours to
		// delete, and is left alone without a warning.
		if (!entry.startsWith(INSTANCE_DIR_PREFIX)) continue;
		const dir = path.join(root, entry);
		try {
			if (!(await stat(dir)).isDirectory()) continue;
			warnings.push(...(await sweepEntry(dir)));
		} catch {
			// Best-effort: one bad entry must not stop the sweep or the launch.
		}
	}

	return warnings;
}
