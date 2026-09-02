import { describe, expect, it } from "vitest";
import { splitFiles } from "./split.js";

describe("splitFiles", () => {
  it("gives a file to the package that owns its directory", () => {
    expect(splitFiles(["viewer/main.py"], ["viewer", "agent-cli"])).toEqual(
      new Map([["viewer", ["viewer/main.py"]]]),
    );
  });

  it("lets the longest matching path win", () => {
    const owned = splitFiles(["a/b/c.ts"], ["a", "a/b"]);
    expect(owned).toEqual(new Map([["a/b", ["a/b/c.ts"]]]));
  });

  it("does not match a sibling sharing a prefix", () => {
    expect(splitFiles(["viewer2/x.ts"], ["viewer"])).toEqual(new Map());
  });

  it("gives a repository-root file to no package", () => {
    expect(splitFiles(["README.md"], ["viewer"])).toEqual(new Map());
  });

  it("gives every file to a root package, root files included", () => {
    expect(splitFiles(["README.md", "viewer/x.py"], ["."])).toEqual(
      new Map([[".", ["README.md", "viewer/x.py"]]]),
    );
  });

  it("handles a dotted package path", () => {
    expect(
      splitFiles([".github/actions/build.js"], [".github/actions"]),
    ).toEqual(
      new Map([[".github/actions", [".github/actions/build.js"]]]),
    );
  });
});
