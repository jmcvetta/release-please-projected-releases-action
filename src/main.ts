/**
 * main renders the projected-releases comment for one pull request.
 *
 * Inputs arrive as flags rather than environment variables so the tool can be
 * driven by hand from a checkout, which is how it is compared against a real
 * merge. The action passes the pull request title and body through the
 * environment and into `--title` / `--body-file`, never through workflow
 * interpolation: a title is attacker-controlled text, and `${{ }}` in a shell
 * line would run it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { GitHub, setLogger } from "release-please";
import { isMalformed } from "./conventional.js";
import { changedFiles } from "./git.js";
import { project, DEFAULT_CONFIG_FILE, DEFAULT_MANIFEST_FILE } from "./project.js";
import type { Projection } from "./project.js";
import { loadReleasePrs } from "./release-prs.js";
import { render } from "./render.js";

/** EMPTY is the projection rendered when the title is withheld from one. */
const EMPTY: Projection = {
  packages: [],
  touched: new Map(),
  files: [],
  projected: [],
  pending: [],
};

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      title: { type: "string" },
      "body-file": { type: "string" },
      repo: { type: "string" },
      // The branch release-please reads, by name. The local ref the changed
      // -file diff runs against is separate (`--diff-base`), because the two
      // are not the same string: release-please wants `master`, git wants
      // `origin/master`.
      base: { type: "string", default: "master" },
      "diff-base": { type: "string", default: "" },
      head: { type: "string", default: "HEAD" },
      "head-sha": { type: "string", default: "" },
      "head-branch": { type: "string", default: "" },
      number: { type: "string", default: "0" },
      token: { type: "string", default: process.env["GITHUB_TOKEN"] ?? "" },
      "repo-root": { type: "string", default: "." },
      "config-file": { type: "string", default: DEFAULT_CONFIG_FILE },
      "manifest-file": { type: "string", default: DEFAULT_MANIFEST_FILE },
      "release-prs": { type: "string" },
      "run-url": { type: "string", default: "" },
      out: { type: "string" },
    },
  });

  const title = values.title;
  if (!title) throw new Error("--title is required");
  const repo = values.repo;
  if (!repo || !repo.includes("/")) {
    throw new Error("--repo is required, as owner/name");
  }
  const [owner = "", name = ""] = repo.split("/");

  // release-please logs to stdout by default, which would land in the middle
  // of the comment body. Send it to stderr, where the Actions log still shows
  // it and the comment stays clean.
  const toStderr = (...args: unknown[]) => console.error(...args);
  setLogger({
    debug: toStderr,
    info: toStderr,
    warn: toStderr,
    error: toStderr,
    trace: toStderr,
    fatal: toStderr,
  } as Parameters<typeof setLogger>[0]);

  const root = values["repo-root"];
  const body = values["body-file"]
    ? readFileSync(values["body-file"], "utf8")
    : "";
  const releasePrs = values["release-prs"]
    ? loadReleasePrs(readFileSync(values["release-prs"], "utf8"))
    : new Map<string, string>();

  const options = {
    title,
    malformed: isMalformed(title),
    releasePrs,
    headSha: values["head-sha"],
    runUrl: values["run-url"],
  };

  // A malformed title is not mergeable as written, so the projection would
  // describe a commit that will never exist. Nothing is worth fetching.
  const projection = options.malformed
    ? EMPTY
    : await run(values, { owner, name, root, title, body });

  const comment = render(projection, options);
  if (values.out) writeFileSync(values.out, comment);
  else process.stdout.write(comment);
  return 0;
}

async function run(
  values: Record<string, string | boolean | undefined>,
  ctx: {
    owner: string;
    name: string;
    root: string;
    title: string;
    body: string;
  },
): Promise<Projection> {
  const base = String(values["base"]);
  const configFile = String(values["config-file"]);
  const manifestFile = String(values["manifest-file"]);
  const readJson = (path: string) =>
    JSON.parse(readFileSync(resolve(ctx.root, path), "utf8"));

  const github = await GitHub.create({
    owner: ctx.owner,
    repo: ctx.name,
    defaultBranch: base,
    ...(values["token"] ? { token: String(values["token"]) } : {}),
  });

  return project({
    github,
    config: readJson(configFile),
    manifest: readJson(manifestFile),
    configFile,
    manifestFile,
    commit: {
      title: ctx.title,
      body: ctx.body,
      files: changedFiles(
        String(values["diff-base"]) || `origin/${base}`,
        String(values["head"]),
      ),
      number: Number(values["number"]) || 0,
      headSha: String(values["head-sha"]) || "0".repeat(40),
      headBranch: String(values["head-branch"]) || "HEAD",
      baseBranch: base,
    },
  });
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  },
);
