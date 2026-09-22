#!/usr/bin/env node
/**
 * postinstall: seed the global catalog with the default starter profile.
 *
 * Runs at package install time (`npm install pi-profile-switch` / `pi install`).
 * Idempotent and conservative:
 * - Writes the shipped `examples/ask.json` starter profile to the
 *   profiles dir ONLY when no .json profile exists there yet
 *   (COPYFILE_EXCL; an existing file — including one written concurrently — is never touched).
 * - Never fails the install: errors are downgraded to a warning.
 *
 * This module is plain Node ESM (no jiti/TS): npm may run postinstall in a
 * context where only plain JS is safe. The path rules intentionally mirror
 * src/workspace.ts — keep them in sync.
 */
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_TEMPLATE = fileURLToPath(new URL("../examples/ask.json", import.meta.url));

/** Mirrors getProfileSwitchDir() in src/workspace.ts.
 *  @param {NodeJS.ProcessEnv} env */
function profileSwitchDir(env) {
	const override = env.PI_PROFILE_SWITCH_DIR;
	if (override && override.trim()) return path.resolve(override.trim());
	return path.join(homedir(), ".pi-profile-switch");
}

/** Mirrors getGlobalProfilesDir() in src/workspace.ts.
 *  @param {NodeJS.ProcessEnv} env */
function globalProfilesDir(env) {
	return path.join(profileSwitchDir(env), "profiles");
}

/** Checks whether the directory exists and contains any .json files.
 *  @param {string} dir */
async function hasAnyJsonProfiles(dir) {
	try {
		const entries = await readdir(dir);
		return entries.some((name) => name.endsWith(".json"));
	} catch {
		return false;
	}
}

/** @typedef {{ path: string, written: boolean }} InstallResult */

/**
 * Seeds the default starter profile. Safe to call repeatedly; only writes
 * if no .json files exist in the global profiles directory.
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<InstallResult>}
 */
export async function installDefaultProfiles({ env = process.env } = {}) {
	const dir = globalProfilesDir(env);
	const target = path.join(dir, "ask.json");

	if (await hasAnyJsonProfiles(dir)) {
		return { path: target, written: false };
	}

	await mkdir(dir, { recursive: true });
	try {
		await copyFile(DEFAULT_TEMPLATE, target, constants.COPYFILE_EXCL);
	} catch (error) {
		// Lost a create race (e.g. two installs in parallel): the winner's
		// file stands; still not ours to overwrite.
		if (error.code === "EEXIST") return { path: target, written: false };
		throw error;
	}
	return { path: target, written: true };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	installDefaultProfiles().then(
		(result) => {
			if (result.written) console.log(`pi-profile: seeded starter profile at ${result.path}`);
		},
		(error) => {
			console.warn(`pi-profile: could not seed starter profile: ${error instanceof Error ? error.message : error}`);
		},
	);
}
