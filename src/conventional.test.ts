import { describe, expect, it } from "vitest";
import {
  HIDDEN_TYPES,
  RECOGNIZED_TYPES,
  RELEASE_BRANCH_PREFIX,
  VISIBLE_TYPES,
  componentOfBranch,
  isMalformed,
  isReleaseBranch,
  titleType,
} from "./conventional.js";

describe("the shared type list", () => {
  it("keeps visible and hidden types disjoint", () => {
    for (const type of VISIBLE_TYPES) expect(HIDDEN_TYPES.has(type)).toBe(false);
  });

  it("recognizes exactly the union of the two", () => {
    expect(RECOGNIZED_TYPES.size).toBe(VISIBLE_TYPES.size + HIDDEN_TYPES.size);
  });

  it("holds the types that can open a release", () => {
    // Asserted against release-please's behaviour in project.test.ts; this
    // pins the list the *comment* explains with to the same set.
    expect([...VISIBLE_TYPES].sort()).toEqual([
      "feat",
      "feature",
      "fix",
      "perf",
      "revert",
    ]);
  });
});

describe("titleType", () => {
  it.each([
    ["feat: a thing", "feat"],
    ["fix(scope): a thing", "fix"],
    ["feat!: a thing", "feat"],
    ["chore(deps)!: a thing", "chore"],
  ])("reads the type from %s", (title, type) => {
    expect(titleType(title)).toBe(type);
  });

  it.each(["no colon here", "feat:no space", ": empty type"])(
    "returns undefined for %s",
    (title) => {
      expect(titleType(title)).toBeUndefined();
    },
  );
});

describe("isMalformed", () => {
  it.each(["feat: a thing", "docs: a thing", "revert: a thing"])(
    "accepts %s",
    (title) => {
      expect(isMalformed(title)).toBe(false);
    },
  );

  it("rejects a subject that is not a Conventional Commit", () => {
    expect(isMalformed("just some words")).toBe(true);
  });

  it("rejects an unrecognized type", () => {
    expect(isMalformed("wip: a thing")).toBe(true);
  });

  // The case that half-works rather than failing: release-please renders it
  // under Features and bumps a patch. See project.test.ts.
  it("rejects a miscased type", () => {
    expect(isMalformed("Feat: a thing")).toBe(true);
  });
});

describe("release branches", () => {
  it("recognizes release-please's own branch", () => {
    const branch = `${RELEASE_BRANCH_PREFIX}branches--master--components--api`;
    expect(isReleaseBranch(branch)).toBe(true);
    expect(componentOfBranch(branch)).toBe("api");
  });

  it("recovers a component containing separators", () => {
    const branch =
      "release-please--branches--master--components--career-scan-agent-cli";
    expect(componentOfBranch(branch)).toBe("career-scan-agent-cli");
  });

  it("leaves an ordinary branch alone", () => {
    expect(isReleaseBranch("topic/whatever")).toBe(false);
    expect(componentOfBranch("topic/whatever")).toBeUndefined();
  });
});
