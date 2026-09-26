import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import piProfileExtension from "../extensions/pi-profile/index.ts";

let root: string;
let savedAgentDir: string | undefined;
let savedSwitchDir: string | undefined;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "pi-profile-ext-"));
	savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	savedSwitchDir = process.env.PI_PROFILE_SWITCH_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	process.env.PI_PROFILE_SWITCH_DIR = root;
});

afterEach(async () => {
	process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	process.env.PI_PROFILE_SWITCH_DIR = savedSwitchDir;
	await rm(root, { recursive: true, force: true });
});

interface FakePi {
	handlers: Map<string, Array<(...args: never[]) => unknown>>;
	commands: Map<string, { description: string; handler: (...args: never[]) => unknown }>;
	events: { on(event: string, handler: unknown): void; emit(event: string, data: unknown): void };
	activeTools: string[];
	sentMessages: Array<{ customType: string; content: unknown; display?: boolean }>;
	on(event: string, handler: (...args: never[]) => unknown): void;
	registerCommand(name: string, def: { description: string; handler: (...args: never[]) => unknown }): void;
	getAllTools(): Array<{ name: string }>;
	setActiveTools(names: string[]): void;
	getCommands(): Array<{ name: string; sourceInfo?: { path: string } }>;
	sendMessage(message: { customType: string; content: unknown; display?: boolean }): void;
}

function fakePi(): FakePi {
	const handlers = new Map<string, Array<(...args: never[]) => unknown>>();
	const commands = new Map<string, { description: string; handler: (...args: never[]) => unknown }>();
	const pi: FakePi = {
		handlers,
		commands,
		events: { on() {}, emit() {} },
		activeTools: [],
		sentMessages: [],
		on(event, handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand(name, def) {
			commands.set(name, def);
		},
		getAllTools: () => ["read", "bash"].map((name) => ({ name })),
		setActiveTools(names) {
			pi.activeTools = names;
		},
		getCommands: () => [],
		sendMessage(message) {
			pi.sentMessages.push(message);
		},
	};
	return pi;
}

function fakeCtx(options?: {
	hasUI?: boolean;
	mode?: "tui" | "rpc" | "json" | "print";
	selectAnswer?: string;
	selectAnswers?: string[];
	inputAnswers?: Array<string | undefined>;
	confirmAnswers?: boolean[];
}) {
	const notifications: Array<{ message: string; level: string }> = [];
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const inputAnswers = [...(options?.inputAnswers ?? [])];
	const confirmAnswers = [...(options?.confirmAnswers ?? [])];
	const selectAnswers = [...(options?.selectAnswers ?? [])];
	// Mirror real Pi: reload re-executes extensions, invalidating this
	// context — property access afterwards throws (the switch's staleness
	// probe reads ctx.cwd).
	let stale = false;
	return {
		notifications,
		selectCalls,
		get cwd() {
			if (stale) throw new Error("context invalidated by reload");
			return root;
		},
		hasUI: options?.hasUI ?? false,
		mode: options?.mode ?? "tui",
		isIdle: () => true,
		waitForIdle: async () => {},
		reload: async () => {
			stale = true;
		},
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
			select: async (title: string, selectOptions: string[]) => {
				selectCalls.push({ title, options: selectOptions });
				return selectAnswers.length > 0 ? selectAnswers.shift() : options?.selectAnswer;
			},
			input: async () => inputAnswers.shift(),
			confirm: async () => confirmAnswers.shift() ?? true,
		},
	};
}

async function writeLaunchPlan(plan: unknown): Promise<void> {
	await mkdir(root, { recursive: true });
	await writeFile(path.join(root, "pi-profile.json"), JSON.stringify(plan));
}

async function writeGlobalProfiles(profiles: Record<string, unknown>): Promise<void> {
	const dir = path.join(root, "profiles");
	await mkdir(dir, { recursive: true });
	for (const [name, definition] of Object.entries(profiles)) {
		await writeFile(path.join(dir, `${name}.json`), JSON.stringify(definition));
	}
}

async function fireSessionStart(pi: FakePi, reason = "startup"): Promise<void> {
	const handler = pi.handlers.get("session_start")?.[0];
	await handler?.({ reason } as never, fakeCtx() as never);
}

async function runBeforeAgentStart(pi: FakePi, systemPrompt: string): Promise<string | undefined> {
	const handler = pi.handlers.get("before_agent_start")?.[0];
	const result = (await handler?.({ systemPrompt } as never, fakeCtx() as never)) as
		| { systemPrompt?: string }
		| undefined;
	return result?.systemPrompt;
}

describe("pi-profile extension", () => {
	it("sets the footer status badge on session start and profile switch", async () => {
		await writeLaunchPlan({ profile: "review", source: "global" });
		const pi = fakePi();
		piProfileExtension(pi as never);

		const statuses: Record<string, string> = {};
		const ctx = fakeCtx();
		(ctx.ui as any).setStatus = (k: string, v: string) => {
			statuses[k] = v;
		};

		const handler = pi.handlers.get("session_start")?.[0];
		await handler?.({ reason: "startup" } as never, ctx as never);

		expect(statuses.profile).toBe("profile: review");
	});

	it("injects the switch summary into exactly one turn after a switch", async () => {
		await writeLaunchPlan({ profile: "impl", source: "global", switchedFrom: "review" });
		const pi = fakePi();
		piProfileExtension(pi as never);
		await fireSessionStart(pi, "reload");

		const withSummary = await runBeforeAgentStart(pi, "BASE");
		expect(withSummary).toContain("review → impl");
		// One-shot: the marker was consumed and cleared from the plan file.
		expect(await runBeforeAgentStart(pi, "BASE")).not.toContain("→");
	});

	it("registers the /profile command naming the accepted subcommand set", async () => {
		await writeLaunchPlan({ profile: "default", source: "builtin", agentDir: root });
		const pi = fakePi();
		piProfileExtension(pi as never);

		const command = pi.commands.get("profile");
		expect(command).toBeDefined();
		expect(command?.description).toBe("pi-profile: /profile [use|reload|status|overlay]");
		const ctx = fakeCtx();
		await command?.handler("bogus" as never, ctx as never);
		expect(ctx.notifications.some((entry) => entry.level === "error" && entry.message.includes("usage"))).toBe(
			true,
		);
	});

	it("rejects removed subcommands as unknown, naming the accepted set", async () => {
		await writeLaunchPlan({ profile: "default", source: "builtin", agentDir: root });
		const pi = fakePi();
		piProfileExtension(pi as never);
		for (const args of ["create", "edit x", "delete x", "duplicate", "list", "reset", "customize disable skill x"]) {
			const ctx = fakeCtx({ mode: "rpc" });
			await pi.commands.get("profile")?.handler(args as never, ctx as never);
			const rejection = ctx.notifications.find((entry) => entry.level === "error" && entry.message.includes("usage"));
			expect(rejection?.message).toBeDefined();
			expect(rejection?.message).toContain("use");
			expect(rejection?.message).toContain("reload");
			expect(rejection?.message).toContain("status");
			expect(rejection?.message).toContain("overlay");
		}
	});

	it("rejects use without a name with the use usage note", async () => {
		await writeLaunchPlan({ profile: "default", source: "builtin", agentDir: root });
		const pi = fakePi();
		piProfileExtension(pi as never);
		const ctx = fakeCtx();
		await pi.commands.get("profile")?.handler("use" as never, ctx as never);
		expect(ctx.notifications.some((entry) => entry.level === "error" && entry.message.includes("usage: /profile use <name>"))).toBe(
			true,
		);
	});

	it("dispatches overlay mutations and overlay clear through the overlay module", async () => {
		await writeLaunchPlan({ profile: "default", source: "builtin", agentDir: root });
		const pi = fakePi();
		piProfileExtension(pi as never);

		// Resolution-time validation errors surface as notifications.
		const disableCtx = fakeCtx();
		await pi.commands.get("profile")?.handler("overlay disable skill ghost" as never, disableCtx as never);
		expect(
			disableCtx.notifications.some(
				(entry) => entry.level === "error" && entry.message.includes('overlay disables unknown skill "ghost"'),
			),
		).toBe(true);

		const clearCtx = fakeCtx();
		await pi.commands.get("profile")?.handler("overlay clear" as never, clearCtx as never);
		expect(clearCtx.notifications.some((entry) => entry.level === "info" && entry.message.includes("overlay cleared"))).toBe(
			true,
		);
	});

	describe("observability surface (ticket 07)", () => {
		it("/profile status sends the resolved plan report", async () => {
			await writeLaunchPlan({
				profile: "review",
				source: "global",
				agentDir: root,
				resolved: { skills: [{ name: "code-review", filePath: "/x/SKILL.md" }], extensions: [] },
				mcps: ["github"],
			});
			const pi = fakePi();
			piProfileExtension(pi as never);

			await pi.commands.get("profile")?.handler("status" as never, fakeCtx() as never);

			const content = String(pi.sentMessages[0]?.content);
			expect(content).toContain("profile: review (global)");
			expect(content).toContain("code-review → /x/SKILL.md");
			expect(content).toContain("mcp: enabled=[github]");
		});

		it("bare /profile falls back to the list without dialog-capable UI", async () => {
			await writeLaunchPlan({ profile: "default", source: "builtin", agentDir: root });
			const pi = fakePi();
			piProfileExtension(pi as never);

			await pi.commands.get("profile")?.handler("" as never, fakeCtx() as never);

			expect(pi.sentMessages).toHaveLength(1);
			expect(String(pi.sentMessages[0]?.content)).toContain("default [builtin]");
		});

		it("bare /profile with UI offers every visible profile and cancels cleanly", async () => {
			await writeLaunchPlan({ profile: "default", source: "builtin", agentDir: root });
			await writeGlobalProfiles({ review: {} });
			const pi = fakePi();
			piProfileExtension(pi as never);
			const ctx = fakeCtx({ hasUI: true, selectAnswer: undefined });

			await pi.commands.get("profile")?.handler("" as never, ctx as never);

			expect(ctx.selectCalls[0]?.options).toContain("default [builtin]");
			expect(ctx.selectCalls[0]?.options).toContain("review [global]");
			// Cancelled: no message, no error notification.
			expect(pi.sentMessages).toHaveLength(0);
			expect(ctx.notifications).toHaveLength(0);
		});
	});

	it("does not register an mcp command (leaves /mcp to pi-mcp-adapter)", async () => {
		const pi = fakePi();
		piProfileExtension(pi as never);
		expect(pi.commands.has("mcp")).toBe(false);
		expect(pi.commands.has("profile")).toBe(true);
	});

	it("/profile resource is rejected as an unknown subcommand", async () => {
		await writeLaunchPlan({ profile: "default", source: "builtin", agentDir: root });
		const pi = fakePi();
		piProfileExtension(pi as never);
		const ctx = fakeCtx();
		await pi.commands.get("profile")?.handler("resource list" as never, ctx as never);
		expect(
			ctx.notifications.some((entry) => entry.level === "error" && entry.message.includes("usage: /profile")),
		).toBe(true);
	});
});
