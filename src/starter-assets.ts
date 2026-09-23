/**
 * Runtime ensure of starter assets: seeds the starter profile into global
 * profiles/ if no profile exists yet, and distributes/syncs the profile-config
 * skill into the user's agent skills directory.
 *
 * Idempotent, safe against concurrent launches, and downgrades IO errors
 * to warnings without throwing.
 */

import { constants } from "node:fs";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { getGlobalProfilesDir } from "./workspace.ts";

export interface StarterAssetFileResult {
	/** 目标文件绝对路径 */
	path: string;
	/** 本次调用是否发生了写入 */
	written: boolean;
}

export interface StarterAssetsResult {
	profile: StarterAssetFileResult;
	skill: StarterAssetFileResult;
	/** 人类可读的降级警告；为空表示全部成功或无操作 */
	warnings: string[];
}

export interface EnsureStarterAssetsOptions {
	/** 默认 getGlobalProfilesDir()；测试注入 */
	globalProfilesDir?: string;
	/** 默认 Pi 的 getAgentDir()；测试注入 */
	agentDir?: string;
	/** 默认由 import.meta.url 定位包根；测试注入 */
	packageRoot?: string;
}

async function hasAnyJsonProfiles(dir: string): Promise<boolean> {
	try {
		const entries = await readdir(dir);
		return entries.some((name) => name.endsWith(".json"));
	} catch (error: unknown) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

export async function ensureStarterAssets(options?: EnsureStarterAssetsOptions): Promise<StarterAssetsResult> {
	const defaultPackageRoot = fileURLToPath(new URL("..", import.meta.url));
	const packageRoot = options?.packageRoot ? path.resolve(options.packageRoot) : defaultPackageRoot;
	const globalProfiles = options?.globalProfilesDir ? path.resolve(options.globalProfilesDir) : getGlobalProfilesDir();
	const agent = options?.agentDir ? path.resolve(options.agentDir) : getAgentDir();

	const profileTemplate = path.join(packageRoot, "examples", "ask.json");
	const targetProfilePath = path.join(globalProfiles, "ask.json");

	const skillTemplate = path.join(packageRoot, "skills", "profile-config", "SKILL.md");
	const targetSkillDir = path.join(agent, "skills", "profile-config");
	const targetSkillPath = path.join(targetSkillDir, "SKILL.md");

	const warnings: string[] = [];
	const profileResult: StarterAssetFileResult = {
		path: targetProfilePath,
		written: false,
	};
	const skillResult: StarterAssetFileResult = {
		path: targetSkillPath,
		written: false,
	};

	// 1. Starter profile seeding
	try {
		const hasJson = await hasAnyJsonProfiles(globalProfiles);
		if (!hasJson) {
			await mkdir(globalProfiles, { recursive: true });
			try {
				await copyFile(profileTemplate, targetProfilePath, constants.COPYFILE_EXCL);
				profileResult.written = true;
			} catch (error: unknown) {
				const err = error as NodeJS.ErrnoException;
				if (err.code === "EEXIST") {
					// Lost a create race (concurrent launch); winner stands
					profileResult.written = false;
				} else {
					throw error;
				}
			}
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`could not seed starter profile: ${message}`);
	}

	// 2. Profile-config skill distribution & sync
	try {
		const templateContent = await readFile(skillTemplate, "utf8");
		let needsWrite = true;
		try {
			const existingContent = await readFile(targetSkillPath, "utf8");
			if (existingContent === templateContent) {
				needsWrite = false;
			}
		} catch (error: unknown) {
			const err = error as NodeJS.ErrnoException;
			if (err.code !== "ENOENT") {
				throw error;
			}
		}

		if (needsWrite) {
			await mkdir(targetSkillDir, { recursive: true });
			await copyFile(skillTemplate, targetSkillPath);
			skillResult.written = true;
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`could not distribute profile-config skill: ${message}`);
	}

	return {
		profile: profileResult,
		skill: skillResult,
		warnings,
	};
}
