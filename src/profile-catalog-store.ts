/**
 * ProfileCatalogStore: the WRITE side of profile catalog files,
 * storing each profile in its own `<name>.json` file.
 *
 * Invariants:
 * - Single-file operations (pretty-printed JSON without schemaVersion envelope).
 * - Writes land in `<dir>/<name>.json` via a temporary file + rename.
 * - Names must match `PROFILE_NAME_PATTERN` and cannot be "default".
 * - Definitions are complete and self-contained: no inheritance fields exist.
 * - Definitions are re-parsed through the catalog's own
 *   `parseProfileDefinition`, so anything written is loadable.
 * - Writes land in exactly one scope directory (global or project).
 */

import { mkdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
	CatalogError,
	DEFAULT_PROFILE_NAME,
	loadCatalogDirectory,
	parseProfileDefinition,
	PROFILE_NAME_PATTERN,
	type ProfileDefinition,
} from "./profile-catalog.ts";

export class ProfileCatalogStore {
	readonly #dirPath: string;

	constructor(catalogDir: string) {
		this.#dirPath = catalogDir;
	}

	/** Validated definitions: missing directory → empty; malformed → CatalogError
	 *  (catalog errors never pass silently, even on the write path). */
	async readDefinitions(): Promise<Map<string, ProfileDefinition>> {
		return loadCatalogDirectory(this.#dirPath);
	}

	/** Inserts or replaces one complete definition (via atomic rename). */
	async upsert(name: string, definition: ProfileDefinition): Promise<void> {
		if (!PROFILE_NAME_PATTERN.test(name)) {
			throw new CatalogError(`invalid profile name "${name}" (must match ${PROFILE_NAME_PATTERN})`);
		}
		if (name === DEFAULT_PROFILE_NAME) {
			throw new CatalogError(`"${DEFAULT_PROFILE_NAME}" is built in and must not be defined in the catalog`);
		}

		// Validate before mutating: the definition must parse.
		const validated = parseProfileDefinition(name, definition);

		await mkdir(this.#dirPath, { recursive: true });
		const targetPath = path.join(this.#dirPath, `${name}.json`);
		const tempPath = path.join(
			this.#dirPath,
			`.${name}.json.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
		);

		try {
			await writeFile(tempPath, `${JSON.stringify(validated, null, 2)}\n`);
			await rename(tempPath, targetPath);
		} catch (error) {
			await rm(tempPath, { force: true });
			throw error;
		}
	}

	/** Removes one profile; unknown names are a loud error, not a no-op. */
	async remove(name: string): Promise<void> {
		if (!PROFILE_NAME_PATTERN.test(name)) {
			throw new CatalogError(`invalid profile name "${name}" (must match ${PROFILE_NAME_PATTERN})`);
		}
		if (name === DEFAULT_PROFILE_NAME) {
			throw new CatalogError(`"${DEFAULT_PROFILE_NAME}" is built in and cannot be deleted`);
		}
		const targetPath = path.join(this.#dirPath, `${name}.json`);
		try {
			await unlink(targetPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new CatalogError(`profile "${name}" not found in ${this.#dirPath}`);
			}
			throw error;
		}
	}
}
