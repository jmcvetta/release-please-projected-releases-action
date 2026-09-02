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
});
