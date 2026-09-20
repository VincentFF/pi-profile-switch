/**
 * AdapterConfigDiscovery: reads MCP server names and configurations
 * pi-mcp-adapter would discover from its standard configuration files,
 * without ever managing them.
 *
 * pi-profile never stores MCP connection parameters or credentials
 * (ADR-0002); this module reads config definitions to validate references
 * before spawn and filter instance mcp.json files.
 *
 * Discovery scope: standard user-global configs (~/.config/mcp/mcp.json,
 * ~/.agents/mcp.json, ~/.agents/mcp/mcp.json), the Pi-global
 * `<agentDir>/mcp.json`, and, when trusted, the project's `.mcp.json` and
 * `.pi/mcp.json`. Servers defined solely in the adapter's editor-specific
 * legacy locations (~/.claude/mcp.json et al.) are invisible here unless
 * imported.
 *
 * Malformed config files fail loudly — a broken mcp.json must not silently
 * read as "no servers" and reject every reference.
 */

import { homedir } from "node:os";
import path from "node:path";

import { isRecord, readJsonFile } from "./json-file.ts";

export class McpConfigError extends Error {
	readonly filePath: string;

	constructor(message: string, filePath: string) {
		super(message);
		this.name = "McpConfigError";
		this.filePath = filePath;
	}
}

export interface McpDiscoveryOptions {
	homeDir?: string;
}

export interface MergedMcpResult {
	servers: Record<string, Record<string, unknown>>;
	sharedServers: Set<string>;
	/** Servers defined in a trusted project's own config (`.mcp.json`,
	 *  `.pi/mcp.json`). They are not the profile's to narrow. */
	projectServers: Set<string>;
	baseConfig?: Record<string, unknown>;
}

export interface McpConfigSource {
	path: string;
	isShared: boolean;
	isAgentDir?: boolean;
	/** Project-scope source: only read for a trusted project, and its servers
	 *  stay enabled regardless of a profile's `mcps` declaration. */
	isProject?: boolean;
}

/**
 * Standard MCP configuration sources recognized by pi-mcp-adapter in precedence order:
 * 1. ~/.config/mcp/mcp.json (user-global standard MCP)
 * 2. ~/.agents/mcp.json (user-global .agents MCP)
 * 3. ~/.agents/mcp/mcp.json (user-global .agents nested MCP)
 * 4. <agentDir>/mcp.json (Pi global override)
 * 5. <projectDir>/.mcp.json (project standard MCP, when project is trusted)
 * 6. <projectDir>/.pi/mcp.json (project Pi override, when project is trusted)
 */
export function getStandardMcpConfigSources(
	agentDir: string,
	projectDir?: string,
	options?: McpDiscoveryOptions,
): McpConfigSource[] {
	const home = options?.homeDir ?? process.env.HOME ?? homedir();
	const sources: McpConfigSource[] = [
		{ path: path.join(home, ".config", "mcp", "mcp.json"), isShared: true },
		{ path: path.join(home, ".agents", "mcp.json"), isShared: true },
		{ path: path.join(home, ".agents", "mcp", "mcp.json"), isShared: true },
		{ path: path.join(agentDir, "mcp.json"), isShared: false, isAgentDir: true },
	];
	if (projectDir !== undefined) {
		sources.push({ path: path.join(projectDir, ".mcp.json"), isShared: true, isProject: true });
		sources.push({ path: path.join(projectDir, ".pi", "mcp.json"), isShared: false, isProject: true });
	}
	return sources;
}

export async function loadMergedMcpServers(
	agentDir: string,
	projectDir?: string,
	options?: McpDiscoveryOptions,
): Promise<MergedMcpResult> {
	const sources = getStandardMcpConfigSources(agentDir, projectDir, options);
	const seenPaths = new Set<string>();
	const servers: Record<string, Record<string, unknown>> = {};
	const sharedServers = new Set<string>();
	const projectServers = new Set<string>();
	let baseConfig: Record<string, unknown> | undefined;

	for (const source of sources) {
		const resolvedPath = path.resolve(source.path);
		if (seenPaths.has(resolvedPath)) continue;
		seenPaths.add(resolvedPath);

		const result = await readJsonFile(resolvedPath);
		if (!result.ok) {
			if (result.reason === "missing") continue;
			throw new McpConfigError(`MCP config is not valid JSON: ${resolvedPath}`, resolvedPath);
		}
		if (!isRecord(result.value)) {
			throw new McpConfigError(`MCP config must be a JSON object: ${resolvedPath}`, resolvedPath);
		}
		if (source.isAgentDir) {
			baseConfig = result.value;
		}
		if (result.value.mcpServers === undefined) continue;
		if (!isRecord(result.value.mcpServers)) {
			throw new McpConfigError(`"mcpServers" must be a JSON object: ${resolvedPath}`, resolvedPath);
		}
		for (const [name, def] of Object.entries(result.value.mcpServers)) {
			if (source.isShared) {
				sharedServers.add(name);
			}
			if (source.isProject === true) {
				projectServers.add(name);
			}
			if (isRecord(def)) {
				servers[name] = { ...(servers[name] ?? {}), ...def };
			} else {
				servers[name] = { ...(servers[name] ?? {}) };
			}
		}
	}

	return { servers, sharedServers, projectServers, baseConfig };
}

/** Server names the adapter would discover: standard global MCP configs,
 *  global agentDir config, plus the trusted project's configs. Pass `projectDir`
 *  only when the trust check passed — an untrusted project's config is never read. */
export async function discoverAdapterServerNames(
	agentDir: string,
	projectDir?: string,
	options?: McpDiscoveryOptions,
): Promise<string[]> {
	const { servers } = await loadMergedMcpServers(agentDir, projectDir, options);
	return Object.keys(servers).sort();
}

export class MissingMcpAdapterError extends Error {
	constructor(profile: string) {
		super(
			`profile "${profile}" declares MCP servers but pi-mcp-adapter is not active. ` +
				`Select the adapter in the profile's extensions (e.g. via its npm package) or remove the "mcps" declaration.`,
		);
		this.name = "MissingMcpAdapterError";
	}
}

/** Identifies the adapter among active extension entries by its install
 *  path containing "pi-mcp-adapter" (npm package roots and local dirs both
 *  match). Heuristic by design — activation-plan entries carry no package
 *  source string. */
export function isAdapterExtension(entry: { entry: string }): boolean {
	return entry.entry.includes("pi-mcp-adapter");
}

