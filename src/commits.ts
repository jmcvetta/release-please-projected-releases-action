/**
 * commits reads the target branch's history once and serves it to both
 * projection passes.
 *
 * A projection runs release-please twice over the same branch — once with the
 * synthetic commit and once without — and the second walk reads the same
 * commits the first one did, from the same API, in the same order. On a
 * repository where the walk is cheap that is a few seconds spent twice. On one
 * where it is not, it is the whole cost paid twice: a measured 103-second walk
 * on `jmcvetta/career` became a 183-second step (issue #54).
 *
 * So the walk is memoized. The cache is filled by the first pass as it is
 * consumed, and the second pass replays it and continues the same upstream
 * iterator where the first one stopped — never a fresh one, which would ask
 * for the same pages again.
 *
 * Two things this must not do, both of which look right and are not:
 *
 * - **Delegate with `yield*`.** release-please stops the walk by breaking out
 *   of a `for await`, which calls `return()` on the generator it is reading —
 *   and `yield*` forwards that to the upstream generator, closing it for good.
 *   The first pass would then leave nothing for the second to continue from.
 *   Pulling one commit at a time keeps the upstream generator merely
 *   suspended.
 * - **Assume the two walks want the same thing.** A call with different
 *   options is a different question, and is delegated whole rather than
 *   answered from the cache.
 */

import type { Commit, GitHub } from "release-please";

/**
 * CommitFiles answers a commit's file list from somewhere cheaper than the
 * REST API, and undefined for a commit it does not know.
 *
 * release-please backfills the file list one serial request per commit for
 * every commit GitHub does not associate with a merged pull request — about
 * 80% of them on a branch that carries direct pushes. See `commitFileIndex`
 * in git.ts, which answers the same question from the local checkout.
 */
export type CommitFiles = (sha: string) => string[] | undefined;

/** CommitSourceOptions are what a source may be given beyond the client. */
export interface CommitSourceOptions {
  /** files serves commit file lists, when something cheaper than the API can. */
  files?: CommitFiles;
}

/**
 * commitSource wraps a release-please `GitHub` so the target branch's history
 * is read once and its file lists come from the cheapest source available.
 *
 * The wrap is an object whose prototype is the client, the same arrangement
 * pr-view.ts uses: inherited methods keep working and the overridden ones are
 * own properties shadowing them. The upstream iterator is created with the
 * wrapper as its receiver, so the file-list override is the one release-please
 * reaches for while backfilling.
 *
 * A client with no `mergeCommitIterator` is returned untouched. That is the
 * seam having moved, which is pr-view.ts's error to raise — it is the one that
 * can explain what breaks.
 */
export function commitSource(
  github: GitHub,
  options: CommitSourceOptions = {},
): GitHub {
  if (typeof github.mergeCommitIterator !== "function") return github;

  const source: GitHub = Object.create(github);
  const serve = options.files;
  if (serve) {
    source.getCommitFiles = async function (sha: string): Promise<string[]> {
      return serve(sha) ?? (await github.getCommitFiles(sha));
    };
  }

  // The question the cache holds an answer to. A second walk asking a
  // different one is delegated rather than answered wrongly.
  let asked: string | undefined;
  const walked: Commit[] = [];
  let upstream: AsyncGenerator<Commit, void, unknown> | undefined;
  let exhausted = false;
  // One pull at a time. The passes are sequential today; a shared generator
  // read from two places at once would interleave, and that is not a failure
  // anyone would enjoy diagnosing.
  let queue: Promise<unknown> = Promise.resolve();

  /** at returns the nth commit of the walk, pulling upstream when the cache
   * does not reach it and undefined once the history runs out. */
  const at = (n: number): Promise<Commit | undefined> => {
    const pull = queue.then(async () => {
      if (n < walked.length) return walked[n];
      if (exhausted || !upstream) return undefined;
      const next = await upstream.next();
      if (next.done) {
        exhausted = true;
        return undefined;
      }
      walked.push(next.value);
      return next.value;
    });
    // A rejected pull must not poison every later one: the chain is for
    // ordering, and the error belongs to the caller that asked.
    queue = pull.then(
      () => undefined,
      () => undefined,
    );
    return pull;
  };

  source.mergeCommitIterator = async function* (
    targetBranch: string,
    iteratorOptions?: Parameters<GitHub["mergeCommitIterator"]>[1],
  ): AsyncGenerator<Commit> {
    const question = JSON.stringify([
      targetBranch,
      iteratorOptions?.maxResults ?? null,
      iteratorOptions?.backfillFiles ?? null,
      iteratorOptions?.batchSize ?? null,
    ]);
    if (asked === undefined) {
      asked = question;
      upstream = github.mergeCommitIterator.call(
        source,
        targetBranch,
        iteratorOptions,
      );
    } else if (question !== asked) {
      yield* github.mergeCommitIterator.call(
        source,
        targetBranch,
        iteratorOptions,
      );
      return;
    }

    for (let n = 0; ; n++) {
      const commit = await at(n);
      if (!commit) return;
      yield commit;
    }
  } as GitHub["mergeCommitIterator"];

  return source;
}
