import { describe, expect, it } from "vitest";
import { indexReleasePrs, loadReleasePrs } from "./release-prs.js";

describe("loadReleasePrs", () => {
  it("keys a release branch by its component", () => {
    const text =
      "release-please--branches--master--components--acme-api\thttps://x/1\n";
    expect(loadReleasePrs(text)).toEqual(
      new Map([["acme-api", "https://x/1"]]),
    );
  });

  it("skips a branch that is not a release branch", () => {
    expect(loadReleasePrs("topic/whatever\thttps://x/2\n")).toEqual(new Map());
  });

  it("skips a release branch with no URL", () => {
    const text = "release-please--branches--master--components--acme-api\t\n";
    expect(loadReleasePrs(text)).toEqual(new Map());
  });
});

describe("indexReleasePrs", () => {
  it("indexes an aggregated release PR under the unnamed component", () => {
    // `separate-pull-requests: false` opens one pull request for the whole
    // repository, on a branch with no `--components--` segment.
    expect(
      indexReleasePrs([
        { headRefName: "release-please--branches--master", url: "https://x/1" },
      ]),
    ).toEqual(new Map([["", "https://x/1"]]));
  });

  it("honours a changed branch prefix", () => {
    expect(
      indexReleasePrs(
        [{ headRefName: "rp--branches--main--components--api", url: "https://x/2" }],
        "rp--",
      ),
    ).toEqual(new Map([["api", "https://x/2"]]));
  });

  it("ignores everything that is not a release branch", () => {
    expect(
      indexReleasePrs([{ headRefName: "topic/whatever", url: "https://x/3" }]),
    ).toEqual(new Map());
  });

  it("keeps only the release PRs targeting the branch asked for", () => {
    // A repository maintaining a maintenance branch has a standing release
    // pull request on each branch, and under the aggregated configuration
    // neither names a component -- so they collide under the empty key. Left
    // colliding, the index looked like the single aggregated one it is not,
    // and the "already pending" cell on a `master` pull request linked the
    // `v1.x` release.
    const prs = [
      { headRefName: "release-please--branches--master", url: "https://x/1" },
      { headRefName: "release-please--branches--v1.x", url: "https://x/2" },
    ];
    expect(indexReleasePrs(prs, undefined, "master")).toEqual(
      new Map([["", "https://x/1"]]),
    );
    expect(indexReleasePrs(prs, undefined, "v1.x")).toEqual(
      new Map([["", "https://x/2"]]),
    );
  });

  it("keeps a component's release PR on the branch asked for", () => {
    const prs = [
      {
        headRefName: "release-please--branches--v1.x--components--api",
        url: "https://x/1",
      },
      {
        headRefName: "release-please--branches--master--components--api",
        url: "https://x/2",
      },
    ];
    expect(indexReleasePrs(prs, undefined, "master")).toEqual(
      new Map([["api", "https://x/2"]]),
    );
  });

  it("indexes every branch when the caller does not name one", () => {
    // The CLI can be pointed at a file of pull requests without saying which
    // branch they target, and narrowing to none of them would be worse than
    // narrowing to all.
    expect(
      indexReleasePrs([
        {
          headRefName: "release-please--branches--v1.x--components--api",
          url: "https://x/1",
        },
      ]),
    ).toEqual(new Map([["api", "https://x/1"]]));
  });
});
