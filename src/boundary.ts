/**
 * boundary reports the components release-please could not find a release
 * boundary for.
 *
 * release-please locates a component's last release by matching a tag or a
 * GitHub release against that component's entry in the manifest. When the two
 * disagree there is no boundary, and the consequences are worse than they
 * look: `Manifest.buildPullRequests` sets `needsBootstrap`, which disables the
 * early exit from the commit walk, so it runs to `commitSearchDepth` — and
 * every commit it reaches is then attributed to the next release. The
 * component's whole history is replayed into one changelog and the version
 * comes out of arithmetic over all of it.
 *
 * That is a real state a repository can be in. It is what a lost tag looks
 * like — two release runs racing, one writing the manifest while the other
 * still holds the tag it has not cut — and it is also what a component's
 * *first* release looks like, which is why this reports the condition rather
 * than diagnosing it.
 *
 * The answer is taken from release-please rather than recomputed. It already
 * resolves each boundary against releases, then tags, then a root-package
 * fallback, honouring `tag-separator`, `include-component-in-tag` and
 * `include-v-in-tag` on the way; a second implementation of that here would
 * be a second set of rules to keep in step, and the failure of a check that
 * quietly stops matching is a warning that never fires. So this reads the
 * line release-please logs when it gives up on a path, which is emitted once
 * per affected component and carries everything needed.
 *
 * Reading a log line is a seam, and it is pinned the only way a seam can be:
 * `boundary.test.ts` drives real release-please over a fixture in this state
 * and asserts the warning comes out. release-please is pinned to an exact
 * version, so the wording cannot move under a running action — but it can
 * move on an upgrade, and that test fails on the dependency bump, where
 * someone is already looking.
 */

import { setLogger } from "release-please";
import type { Logger } from "release-please";

/** UnresolvedBoundary is one component whose manifest version names no release. */
export interface UnresolvedBoundary {
  /** path is the package directory, as the config declares it. */
  path: string;
  /** component is the name release-please knows the package by. Empty for a
   * package that keeps its component out of its tags. */
  component: string;
  /** version is the manifest entry no release or tag was found for. */
  version: string;
}

// manifest.ts, in the loop that fills in a missing release from the manifest:
// `No latest release found for path: ${path}, component: ${component}, but a
// previous version (${version}) was specified in the manifest.`
const UNRESOLVED =
  /^No latest release found for path: (.*), component: (.*), but a previous version \((.*)\) was specified in the manifest\.$/;

/**
 * parseUnresolvedBoundary reads one such line, or returns undefined for any
 * other message.
 */
export function parseUnresolvedBoundary(
  message: string,
): UnresolvedBoundary | undefined {
  const found = UNRESOLVED.exec(message);
  if (!found) return undefined;
  return { path: found[1] ?? "", component: found[2] ?? "", version: found[3] ?? "" };
}

/** SILENT drops everything, which is what a library does when nobody has said
 * where its logging should go. */
const SILENT: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
};

let watching = false;
let seen: UnresolvedBoundary[] = [];

/**
 * watchBoundaries routes release-please's logging through `sink` and records
 * the unresolved-boundary lines on the way past.
 *
 * Installing it replaces whatever logger was set, which is why the sink is
 * required: release-please's own default writes to stdout, and the CLI prints
 * the comment body there.
 *
 * The recorder is built from the sink's own methods rather than from the
 * `Logger` interface, so a sink carrying more than the interface declares --
 * a `fatal`, say -- keeps every level it came with. Only `info` is wrapped,
 * which is the level the line is logged at.
 */
export function watchBoundaries(sink: Logger): void {
  const record: Record<string, unknown> = {};
  for (const [level, fn] of Object.entries(sink)) {
    if (typeof fn !== "function") continue;
    record[level] =
      level === "info"
        ? (...args: unknown[]) => {
            // The call site passes a single formatted string. A logger is
            // also allowed an object first, which is never this message.
            const [message] = args;
            if (typeof message === "string") {
              const found = parseUnresolvedBoundary(message);
              if (found) seen.push(found);
            }
            (fn as (...a: unknown[]) => void).apply(sink, args);
          }
        : (...args: unknown[]) =>
            (fn as (...a: unknown[]) => void).apply(sink, args);
  }
  watching = true;
  seen = [];
  setLogger(record as unknown as Logger);
}

/**
 * armBoundaryWatch installs the recorder over a silent sink unless a caller
 * has already chosen one.
 *
 * It is what makes the warning work for an embedder that never asked for
 * logging -- a test driving `buildComment` directly, say. Silence is the right
 * default for that: a library that starts printing because it was asked for a
 * projection is worse than one that says nothing.
 */
export function armBoundaryWatch(): void {
  if (!watching) watchBoundaries(SILENT);
}

/**
 * drainBoundaries returns what has been recorded since the last drain, and
 * clears it.
 *
 * Draining rather than reading is what lets one run attribute its two passes
 * separately: the pull request's view of the repository and the target
 * branch's can disagree about this, and usually do while someone is repairing
 * it.
 */
export function drainBoundaries(): UnresolvedBoundary[] {
  const found = seen;
  seen = [];
  return found;
}
