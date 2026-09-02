import { describe, expect, it } from "vitest";
import { loadReleasePrs } from "./release-prs.js";

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
