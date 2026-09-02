/**
 * The fork-safe example is two workflow files that have to agree, and nothing
 * fails when they do not.
 *
 * The pair is joined by three strings written twice: the rendering workflow's
 * `name`, which the companion subscribes to; the artifact name one uploads and
 * the other downloads; and the file the number travels in. Get one wrong and
 * the companion simply never runs, or runs and cannot find what it came for.
 * The same goes for the condition: `types: [completed]` fires on every ending,
 * including the skips this action does deliberately, and a companion that does
 * not check the conclusion downloads an artifact that was never uploaded and
 * puts a red check on the pull request.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

interface Workflow {
  name: string;
  on: Record<string, { workflows?: string[]; types?: string[] }>;
  jobs: Record<
    string,
    { if?: string; steps: { uses?: string; with?: Record<string, string> }[] }
  >;
}

const example = (file: string): Workflow =>
  parse(
    readFileSync(new URL(`../examples/${file}`, import.meta.url), "utf8"),
  ) as Workflow;

const render = example("fork-safe-render.yml");
const comment = example("fork-safe-comment.yml");

/** stepsUsing finds the steps of a workflow that use one action. */
function stepsUsing(workflow: Workflow, action: string) {
  return Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .filter((step) => step.uses?.startsWith(`${action}@`));
}

describe("the fork-safe example pair", () => {
  it("subscribes to the workflow that renders", () => {
    expect(comment.on["workflow_run"]?.workflows).toEqual([render.name]);
  });

  it("waits for the run to have succeeded, not merely finished", () => {
    // The rendering job skips itself on release-please's own branches, and a
    // run that skipped or failed uploaded no artifact. Without this the
    // download below fails on every release pull request.
    const condition = comment.jobs["comment"]?.if ?? "";
    expect(condition).toContain("github.event.workflow_run.conclusion");
    expect(condition).toContain("'success'");
  });

  it("downloads the artifact the other half uploads", () => {
    const uploaded = stepsUsing(render, "actions/upload-artifact")[0];
    const downloaded = stepsUsing(comment, "actions/download-artifact")[0];
    expect(uploaded?.with?.["name"]).toBeTruthy();
    expect(downloaded?.with?.["name"]).toBe(uploaded?.with?.["name"]);
  });

  it("carries the pull request number in the file it reads back", () => {
    const uploaded = stepsUsing(render, "actions/upload-artifact")[0];
    const paths = uploaded?.with?.["path"] ?? "";
    const written = Object.values(render.jobs)
      .flatMap((job) => job.steps)
      .map((step) => (step as { run?: string }).run ?? "")
      .join("\n");
    const read = Object.values(comment.jobs)
      .flatMap((job) => job.steps)
      .map((step) => (step as { run?: string }).run ?? "")
      .join("\n");
    for (const source of [paths, written, read]) {
      expect(source).toContain("pr-number.txt");
    }
  });
});
