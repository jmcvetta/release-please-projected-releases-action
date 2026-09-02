import { describe, expect, it } from "vitest";
import {
  DEFAULT_TYPES,
  HIDDEN_TYPES,
  RECOGNIZED_TYPES,
  RELEASE_BRANCH_PREFIX,
  VISIBLE_TYPES,
  componentOfBranch,
  isMalformed,
  isReleaseBranch,
  releaseBranch,
  resolveTypes,
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
      "release-please--branches--master--components--acme-api-client";
    expect(componentOfBranch(branch)).toBe("acme-api-client");
  });

  it("leaves an ordinary branch alone", () => {
    expect(isReleaseBranch("topic/whatever")).toBe(false);
    expect(componentOfBranch("topic/whatever")).toBeUndefined();
  });
});

describe("resolveTypes", () => {
  it("falls back to the conventionalcommits defaults", () => {
    expect(resolveTypes()).toEqual(DEFAULT_TYPES);
    expect(resolveTypes({ config: { packages: { api: {} } } }).visible).toEqual(
      DEFAULT_TYPES.visible,
    );
  });

  it("takes a config's changelog-sections as the whole visible list", () => {
    // Declaring `changelog-sections` replaces the preset's `types` rather
    // than adding to them, so a repository that declares three sections
    // renders three -- `perf` opens no release of its own here.
    const types = resolveTypes({
      config: {
        "changelog-sections": [
          { type: "feat", section: "Features" },
          { type: "fix", section: "Fixes" },
          { type: "chore", section: "Chores", hidden: true },
        ],
      },
    });
    expect([...types.visible].sort()).toEqual(["feat", "fix"]);
    expect(types.hidden.has("chore")).toBe(true);
  });

  it("leaves a type the sections omit recognized, and so mergeable", () => {
    // The sections decide what the changelog renders, not what a commit may
    // be. A type they omit is hidden -- it renders nothing and opens no
    // release -- but it is still an ordinary Conventional Commit, and calling
    // its title malformed put "None -- malformed PR title" on every `chore:`
    // and `docs:` pull request in a repository that declared three sections.
    const types = resolveTypes({
      config: {
        "changelog-sections": [
          { type: "feat", section: "Features" },
          { type: "fix", section: "Fixes" },
        ],
      },
    });
    expect(types.visible.has("perf")).toBe(false);
    expect(types.hidden.has("perf")).toBe(true);
    expect(isMalformed("chore: tidy", types)).toBe(false);
    expect(isMalformed("docs: explain", types)).toBe(false);
    expect(isMalformed("nonsense: it", types)).toBe(true);
  });

  it("unions the sections a package declares with the top-level ones", () => {
    // A type any component renders can open a release, so calling it hidden
    // repository-wide would be wrong for that component.
    const types = resolveTypes({
      config: {
        "changelog-sections": [{ type: "feat", section: "Features" }],
        packages: {
          docs: { "changelog-sections": [{ type: "docs", section: "Docs" }] },
        },
      },
    });
    expect([...types.visible].sort()).toEqual(["docs", "feat"]);
  });

  it("lets an explicit list beat the config", () => {
    const types = resolveTypes({
      config: { "changelog-sections": [{ type: "feat", section: "Features" }] },
      visible: ["ship"],
    });
    expect([...types.visible]).toEqual(["ship"]);
  });

  it("never counts a type as both visible and hidden", () => {
    const types = resolveTypes({ visible: ["feat"], hidden: ["feat", "chore"] });
    expect(types.visible.has("feat")).toBe(true);
    expect(types.hidden.has("feat")).toBe(false);
    expect(types.recognized.size).toBe(2);
  });

  it("judges a title against the resolved list, not the defaults", () => {
    const types = resolveTypes({ visible: ["ship"], hidden: [] });
    expect(isMalformed("ship: it", types)).toBe(false);
    expect(isMalformed("feat: it", types)).toBe(true);
    // Miscasing stays malformed whatever the list says, because it
    // half-works: a Features entry rendered against a patch bump.
    expect(isMalformed("Ship: it", types)).toBe(true);
  });
});

describe("componentOfBranch, on the shapes other repositories have", () => {
  it("reads a branch with no components segment as the unnamed component", () => {
    // A repository releasing one component, or aggregating every component
    // into one pull request, gets this shape. It is still a release branch,
    // and its component is the empty name release-please gave it.
    expect(componentOfBranch("release-please--branches--master")).toBe("");
  });

  it("recovers the branch a release targets, not just its component", () => {
    expect(releaseBranch("release-please--branches--master")).toEqual({
      base: "master",
      component: "",
    });
    expect(
      releaseBranch("release-please--branches--v1.x--components--acme-api"),
    ).toEqual({ base: "v1.x", component: "acme-api" });
    expect(releaseBranch("topic/whatever")).toBeUndefined();
  });

  it("keeps a component containing the separator whole", () => {
    expect(
      componentOfBranch("release-please--branches--master--components--a--b"),
    ).toBe("a--b");
  });

  it("honours a prefix a repository has changed", () => {
    expect(componentOfBranch("rp--branches--main--components--x", "rp--")).toBe("x");
    expect(
      componentOfBranch("release-please--branches--main", "rp--"),
    ).toBeUndefined();
  });
});
