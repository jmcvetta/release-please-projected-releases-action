import { describe, expect, it } from "vitest";
import { isMergeMethod, mergeAdvisories } from "./merge-method.js";

const squashable = {
  allowSquash: true,
  allowMerge: true,
  allowRebase: true,
  squashTitle: "PR_TITLE",
};

describe("isMergeMethod", () => {
  it("accepts the four values and nothing else", () => {
    expect(isMergeMethod("auto")).toBe(true);
    expect(isMergeMethod("squash")).toBe(true);
    expect(isMergeMethod("fast-forward")).toBe(false);
  });
});

describe("mergeAdvisories", () => {
  it("says nothing about an ordinary squash-merging repository", () => {
    expect(mergeAdvisories({ method: "auto", settings: squashable, commits: 3 })).toEqual([]);
  });

  it("says nothing merely because merge commits are also allowed", () => {
    // Nearly every repository allows all three, and a note on every pull
    // request is a note nobody reads.
    expect(mergeAdvisories({ method: "squash", commits: 2 })).toEqual([]);
  });

  it("warns when the declared method is not squash", () => {
    const [note] = mergeAdvisories({ method: "rebase" });
    expect(note).toContain("does not describe this merge");
  });

  it("warns when the repository cannot squash at all", () => {
    const [note] = mergeAdvisories({
      method: "auto",
      settings: { ...squashable, allowSquash: false },
    });
    expect(note).toContain("does not allow squash-merge");
  });

  it("warns when a single commit will supply the subject instead of the title", () => {
    // COMMIT_OR_PR_TITLE prefills the squash subject from the branch's only
    // commit when there is one, so the title the gate checked is not the
    // subject release-please will parse.
    const [note] = mergeAdvisories({
      method: "auto",
      settings: { ...squashable, squashTitle: "COMMIT_OR_PR_TITLE" },
      commits: 1,
    });
    expect(note).toContain("COMMIT_OR_PR_TITLE");
  });

  it("does not warn about COMMIT_OR_PR_TITLE with more than one commit", () => {
    expect(
      mergeAdvisories({
        method: "auto",
        settings: { ...squashable, squashTitle: "COMMIT_OR_PR_TITLE" },
        commits: 2,
      }),
    ).toEqual([]);
  });

  it("says nothing when the settings could not be read", () => {
    expect(mergeAdvisories({ method: "auto" })).toEqual([]);
  });
});
