/**
 * The bundled entry point decides which of the two programs is being run, and
 * reports a failure of either.
 *
 * One artifact serves the action and the command line, so the dispatch is the
 * first thing that happens on every invocation and the last thing anything
 * else can compensate for: sending an action run down the command line path
 * would fail on `--title is required`, naming a flag no workflow passes.
 *
 * The reporting matters for a narrower reason. A thrown error reaches the
 * runner as a stack on stderr, which is in the log and nowhere else; the
 * `::error::` line is what puts the first line of it on the run's summary
 * page, where someone who did not open the log will see it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

/** Result is what one invocation of the entry point wrote and left behind. */
interface Result {
  stderr: string;
  stdout: string;
  exitCode: number | string | null | undefined;
}

const saved = { ...process.env };
const savedArgv = process.argv;

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, saved);
  process.argv = savedArgv;
  process.exitCode = 0;
});

/**
 * entryPoint imports the module, which runs it, and resolves once it has
 * reported. The module exports nothing and awaits nothing, so the write to
 * stderr is what says it is done.
 */
async function entryPoint(
  argv: string[],
  env: Record<string, string> = {},
): Promise<Result> {
  // A runner sets GITHUB_REPOSITORY and GITHUB_EVENT_PATH, which the action
  // reads as its defaults -- so inheriting them would move which check fires
  // first and make the assertions below describe a different run in CI than
  // on a laptop.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("INPUT_") || key.startsWith("GITHUB_")) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, env);
  process.argv = [process.execPath, "index.mjs", ...argv];

  const stderr: string[] = [];
  const stdout: string[] = [];
  let reported: () => void = () => {};
  const done = new Promise<void>((resolve) => (reported = resolve));
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    reported();
    return true;
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });

  vi.resetModules();
  await import("./index.js");
  await done;
  // The annotation is written after the stack, so let that turn finish.
  await new Promise((resolve) => setImmediate(resolve));

  return {
    stderr: stderr.join(""),
    stdout: stdout.join(""),
    exitCode: process.exitCode,
  };
}

describe("the entry point", () => {
  it("runs the command line when there are arguments", async () => {
    // `--title` is a flag only the command line has, so reaching its own
    // check is what says the dispatch went that way.
    const result = await entryPoint(["--repo", "acme/widgets"]);
    expect(result.stderr).toContain("--title is required");
  });

  it("runs the action when there are none", async () => {
    // And `mode` is an input only the action has.
    const result = await entryPoint([], { INPUT_MODE: "post" });
    expect(result.stderr).toContain("input `mode` must be one of");
  });

  it("reports the stack, and fails the run", async () => {
    const result = await entryPoint(["--repo", "acme/widgets"]);
    // The stack, not just the message: a failure here is in this action's own
    // code as often as in its inputs.
    expect(result.stderr).toContain("at ");
    expect(result.exitCode).toBe(1);
  });

  it("annotates the first line of it on a runner", async () => {
    const result = await entryPoint(["--repo", "acme/widgets"], {
      GITHUB_ACTIONS: "true",
    });
    expect(result.stdout).toBe("::error::Error: --title is required\n");
  });

  it("annotates nothing off a runner", async () => {
    const result = await entryPoint(["--repo", "acme/widgets"]);
    expect(result.stdout).toBe("");
  });
});
