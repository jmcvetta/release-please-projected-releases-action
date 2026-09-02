/**
 * runner is the GitHub Actions runtime: inputs in, outputs and annotations
 * out, and the event payload the action defaults its context from.
 *
 * Written against the runner's documented protocol rather than through
 * `@actions/core`. The protocol is three environment conventions and a file
 * append; the dependency is a package to keep pinned, and the bundle already
 * carries release-please's whole dependency tree.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

/** Env is the process environment, injected so the module is testable. */
export type Env = Record<string, string | undefined>;

/**
 * input reads an action input.
 *
 * The runner passes `foo-bar` as `INPUT_FOO-BAR`, uppercased with spaces
 * turned into underscores and nothing else changed. Values are trimmed,
 * because a YAML block scalar arrives with a trailing newline.
 */
export function input(name: string, env: Env = process.env): string {
  const key = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  return (env[key] ?? "").trim();
}

/** inputOr reads an input, falling back when it is empty. */
export function inputOr(name: string, fallback: string, env: Env = process.env): string {
  return input(name, env) || fallback;
}

/** boolInput reads a boolean input the way the runner's own actions do:
 * `true`/`false`, case-insensitive, with anything else an error. */
export function boolInput(
  name: string,
  fallback: boolean,
  env: Env = process.env,
): boolean {
  const value = input(name, env).toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`input \`${name}\` must be true or false, got \`${value}\``);
}

/**
 * listInput reads an input written as a comma-, space- or newline-separated
 * list, or undefined when it is empty. Empty is distinct from "no items":
 * an unset type-list input means "resolve them", not "there are none".
 */
export function listInput(
  name: string,
  env: Env = process.env,
): string[] | undefined {
  const value = input(name, env);
  if (!value) return undefined;
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * setOutput writes an action output.
 *
 * Through the delimited heredoc form, always. A projected changelog contains
 * newlines, and the older `::set-output::` command cannot carry one.
 */
export function setOutput(
  name: string,
  value: string,
  env: Env = process.env,
): void {
  const file = env["GITHUB_OUTPUT"];
  if (!file) return;
  const delimiter = `ghadelimiter_${randomUUID()}`;
  if (name.includes(delimiter) || value.includes(delimiter)) {
    throw new Error("output collided with its own delimiter");
  }
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

/** summary appends markdown to the run's job summary, when there is one. */
export function summary(markdown: string, env: Env = process.env): void {
  const file = env["GITHUB_STEP_SUMMARY"];
  if (!file) return;
  appendFileSync(file, `${markdown}\n`);
}

/** escapeData quotes a workflow-command message: `%`, CR and LF are the
 * three characters the command syntax cannot carry literally. */
function escapeData(message: string): string {
  return message
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

/** notice, warning and error write runner annotations, which surface on the
 * run's summary page rather than only in the log. */
export function notice(message: string): void {
  process.stdout.write(`::notice::${escapeData(message)}\n`);
}

/** warning writes a runner warning annotation. */
export function warning(message: string): void {
  process.stdout.write(`::warning::${escapeData(message)}\n`);
}

/** error writes a runner error annotation. */
export function error(message: string): void {
  process.stdout.write(`::error::${escapeData(message)}\n`);
}

/** PullRequestEvent is the part of a webhook payload this action defaults
 * its context from. Everything here is overridable by an input, because a
 * `workflow_run` companion job has no pull request payload at all. */
export interface PullRequestEvent {
  number?: number;
  title?: string;
  body?: string;
  commits?: number;
  base?: string;
  headSha?: string;
  headBranch?: string;
  /** headRepo is the head's repository as owner/name, which differs from the
   * base repository exactly when the pull request comes from a fork. */
  headRepo?: string;
}

/**
 * readEvent reads the pull request out of `GITHUB_EVENT_PATH`.
 *
 * Missing, unreadable or not a pull request event all return an empty
 * context rather than raising: the inputs can supply everything, and a
 * `workflow_run` job legitimately has no pull request in its payload.
 */
export function readEvent(env: Env = process.env): PullRequestEvent {
  const path = env["GITHUB_EVENT_PATH"];
  if (!path) return {};
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
  const pr = payload["pull_request"] as Record<string, unknown> | undefined;
  if (!pr) return {};
  const base = pr["base"] as Record<string, unknown> | undefined;
  const head = pr["head"] as Record<string, unknown> | undefined;
  const headRepo = head?.["repo"] as Record<string, unknown> | undefined;
  return {
    ...(typeof pr["number"] === "number" ? { number: pr["number"] } : {}),
    ...(typeof pr["title"] === "string" ? { title: pr["title"] } : {}),
    ...(typeof pr["body"] === "string" ? { body: pr["body"] } : {}),
    ...(typeof pr["commits"] === "number" ? { commits: pr["commits"] } : {}),
    ...(typeof base?.["ref"] === "string" ? { base: base["ref"] } : {}),
    ...(typeof head?.["sha"] === "string" ? { headSha: head["sha"] } : {}),
    ...(typeof head?.["ref"] === "string" ? { headBranch: head["ref"] } : {}),
    ...(typeof headRepo?.["full_name"] === "string"
      ? { headRepo: headRepo["full_name"] }
      : {}),
  };
}
