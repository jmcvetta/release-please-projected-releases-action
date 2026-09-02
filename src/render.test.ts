import { describe, expect, it } from "vitest";
import { resolveTypes } from "./conventional.js";
import type { PackageConfig, Projection } from "./project.js";
import { tagFor } from "./project.js";
import { bumpLevel, footer, render } from "./render.js";

const API: PackageConfig = {
  path: "api",
  component: "acme-api",
  releaseComponent: "acme-api",
  current: "2.4.1",
  separator: "@",
  includeComponent: true,
};
const UI: PackageConfig = {
  path: "ui",
  component: "acme-ui",
  releaseComponent: "acme-ui",
  current: "1.0.0",
  separator: "@",
  includeComponent: true,
};

const NOW = new Date("2026-09-01T12:00:00Z");

function projection(over: Partial<Projection> = {}): Projection {
  return {
    packages: [API, UI],
    touched: new Map([["api", ["api/src/x.ts"]]]),
    files: ["api/src/x.ts"],
    projected: [],
    pending: [],
    ...over,
  };
}

function body(p: Projection, over: Record<string, unknown> = {}): string {
  return render(p, {
    title: "feat: a thing",
    malformed: false,
    now: NOW,
    ...over,
  });
}

describe("tagFor", () => {
  it("spells the component-prefixed form", () => {
    expect(tagFor(API, "2.5.0")).toBe("acme-api@v2.5.0");
  });

  it("omits the component when the config says to", () => {
    expect(tagFor({ ...API, includeComponent: false }, "2.5.0")).toBe("v2.5.0");
  });
});

describe("bumpLevel", () => {
  it.each([
    ["2.4.1", "3.0.0", "major"],
    ["2.4.1", "2.5.0", "minor"],
    ["2.4.1", "2.4.2", "patch"],
    ["2.4.1", "2.4.1", "no"],
  ])("reads %s to %s as a %s bump", (from, to, level) => {
    expect(bumpLevel(from, to)).toBe(level);
  });
});

describe("the table", () => {
  it("names the tag and both versions", () => {
    const out = body(
      projection({
        projected: [{ component: "acme-api", version: "2.5.0", notes: "- x" }],
      }),
    );
    expect(out).toContain("`acme-api@v2.5.0`");
    expect(out).toContain("| 2.4.1 |");
    expect(out).toContain("**2.5.0**");
    expect(out).toContain("minor bump.");
  });

  it("links the pending version to the release pull request holding it", () => {
    const out = body(
      projection({
        projected: [{ component: "acme-api", version: "3.0.0", notes: "" }],
        pending: [{ component: "acme-api", version: "2.5.0", notes: "" }],
      }),
      { releasePrs: new Map([["acme-api", "https://example.test/pr/9"]]) },
    );
    expect(out).toContain("[2.5.0](https://example.test/pr/9)");
  });

  it("shows the changelog release-please rendered", () => {
    const out = body(
      projection({
        projected: [
          { component: "acme-api", version: "2.5.0", notes: "### Features" },
        ],
      }),
    );
    expect(out).toContain("Changelog preview");
    expect(out).toContain("### Features");
  });
});

describe("a release this pull request does not cause", () => {
  const absorbed = projection({
    projected: [{ component: "acme-api", version: "2.5.0", notes: "" }],
    pending: [{ component: "acme-api", version: "2.5.0", notes: "" }],
  });

  // Naming its tag in the table would claim a bump that is coming from
  // commits already on the target branch.
  it("moves out of the table into a note", () => {
    const out = body(absorbed);
    expect(out).toContain("No component's version changes.");
    expect(out).toContain("stays at 2.5.0");
    expect(out).not.toContain("**2.5.0**");
  });

  // "Already pending" says a release pull request is standing. Claiming it
  // without having found one contradicts the Current column in the same
  // comment: a repository that has never released shows no current version
  // and has no release pull request to point at. Observed on this action's
  // own repository, which reported "stays at 1.0.0, already pending" beside
  // "Current: —" before any release existed.
  it("does not claim a release is pending when none was found", () => {
    const out = body(absorbed, { base: "master" });
    expect(out).not.toContain("already pending");
    expect(out).toContain("`master` already releases without it");
  });

  it("says pending, and links it, when a release PR was found", () => {
    const out = body(absorbed, {
      releasePrs: new Map([["acme-api", "https://x/9"]]),
    });
    expect(out).toContain("stays at [2.5.0](https://x/9), already pending;");
  });

  it("falls back to a generic phrase when no base branch was given", () => {
    expect(body(absorbed)).toContain("the target branch already releases without it");
  });

  // The feature does ship, in the notes of the version already pending.
  it("credits a visible type with the changelog line it adds", () => {
    const out = body(absorbed, { title: "feat: another feature" });
    expect(out).toContain("this PR adds a changelog line to it, not a version.");
    expect(out).not.toContain("adds no changelog line");
  });

  it("tells a hidden type that it contributes nothing", () => {
    const out = body(absorbed, { title: "docs: a note", base: "master" });
    expect(out).toContain("`docs` adds no changelog line and changes no version.");
    expect(out).toContain("`master` releases the same versions without it.");
    expect(out).toContain("this PR does not move it.");
    // Same overclaim as the note above, in the warning.
    expect(out).not.toContain("already pending");
  });
});

describe("saying that nothing releases", () => {
  it("blames the files when no component is touched", () => {
    const out = body(
      projection({
        touched: new Map(),
        files: ["job-descriptions/2026-09-r1/01-x.md", "pipeline.json"],
      }),
    );
    expect(out).toContain("no changed file is under a component path");
    expect(out).toContain("`job-descriptions`");
    expect(out).toContain("`pipeline.json`");
  });

  it("blames the type when a component is touched but nothing releases", () => {
    const out = body(projection(), { title: "docs: a thing" });
    expect(out).toContain("`docs` is a hidden type");
    expect(out).toContain("Components touched: `acme-api`.");
  });

  // Another component's standing release pull request is not this one's
  // business, and counting it made the verdict contradict the warning three
  // lines below it.
  it("scopes the pending claim to the components touched", () => {
    const out = body(
      projection({
        pending: [{ component: "acme-ui", version: "1.1.0", notes: "" }],
      }),
      { title: "docs: a thing" },
    );
    expect(out).toContain("no component it touches has a release pending");
    expect(out).not.toContain("nothing user-facing is pending");
    expect(out).not.toContain("happen without it");
  });

  // Reachable when release-please attributes a file to no component that this
  // preview counts as touched -- a package's excluded path, say.
  it("does not call a visible type hidden", () => {
    const out = body(projection(), { title: "feat: a thing" });
    expect(out).toContain("release-please projects no release");
    expect(out).not.toContain("hidden type");
    expect(out).toContain("Components touched: `acme-api`.");
  });
});

describe("Release-As", () => {
  it("says the note forced the version", () => {
    const out = body(
      projection({
        releaseAs: "9.9.9",
        projected: [{ component: "acme-api", version: "9.9.9", notes: "" }],
      }),
    );
    expect(out).toContain("`Release-As: 9.9.9` forces the version.");
  });

  it("warns when release-please returned a different version", () => {
    const out = body(
      projection({
        releaseAs: "9.9.9",
        ignoredReleaseAs: "9.9.9",
        projected: [{ component: "acme-api", version: "2.4.2", notes: "" }],
      }),
    );
    expect(out).toContain("was **ignored**");
    expect(out).toContain("no non-trailer text may follow");
  });
});

describe("a malformed title", () => {
  // Such a title is not mergeable as written, so any projection from it
  // describes a commit that will never exist.
  it("gets a withheld notice rather than a prediction", () => {
    const out = render(projection(), {
      title: "Feat: a thing",
      malformed: true,
      now: NOW,
    });
    expect(out).toContain("None — malformed PR title.");
    expect(out).toContain("> Feat: a thing");
    expect(out).not.toContain("| Component |");
  });
});

describe("the footer", () => {
  // A sticky comment is edited in place, so a re-render that changes no
  // verdict is indistinguishable from one that never ran without this line.
  it("stamps the commit and the render time", () => {
    expect(footer({ title: "", malformed: false, headSha: "abcdef1234567890", now: NOW }))
      .toBe("<sub>Projected for `abcdef1` · re-rendered 2026-09-01 12:00 UTC</sub>");
  });

  it("links the run when it has one", () => {
    const out = footer({
      title: "",
      malformed: false,
      now: NOW,
      runUrl: "https://example.test/run/1",
    });
    expect(out).toContain("[re-rendered 2026-09-01 12:00 UTC](https://example.test/run/1)");
  });
});

describe("advisories", () => {
  const advisory = "- this repository does not squash-merge";

  it("renders alongside the projection's own warnings", () => {
    const out = body(projection(), { advisories: [advisory] });
    expect(out).toContain(advisory);
  });

  it("survives a withheld projection", () => {
    // "this repository does not squash-merge" is as true of a malformed
    // title as of a good one, and it is the note most likely to explain why
    // the whole comment is beside the point.
    const out = body(projection(), {
      title: "WIP whatever",
      malformed: true,
      advisories: [advisory],
    });
    expect(out).toContain("malformed PR title");
    expect(out).toContain(advisory);
  });
});

describe("a repository whose changelog recognizes other types", () => {
  const types = resolveTypes({
    config: {
      "changelog-sections": [
        { type: "ship", section: "Shipped" },
        { type: "tidy", section: "Tidying", hidden: true },
      ],
    },
  });

  it("explains a hidden type against that repository's visible list", () => {
    const out = body(projection(), { title: "tidy: sweep up", types });
    expect(out).toContain("`tidy` is a hidden type");
    expect(out).toContain("Only `ship` open a release.");
    expect(out).not.toContain("`feat`");
  });

  it("names the recognized types when it withholds a projection", () => {
    const out = body(projection(), {
      title: "nonsense: a thing",
      malformed: true,
      types,
    });
    expect(out).toContain("`ship`");
    expect(out).toContain("`tidy`");
  });
});

// release-please's default aggregates every component into one release pull
// request, on a branch naming none of them, which indexes under the empty
// string. Looking a real component up in that index found nothing, so the
// links never appeared for the ordinary configuration.
describe("linking an aggregated release pull request", () => {
  const aggregated = new Map([["", "https://example.test/pr/9"]]);

  it("links a pending version to the one pull request holding it", () => {
    const out = body(
      projection({
        projected: [{ component: "acme-api", version: "3.0.0", notes: "" }],
        pending: [{ component: "acme-api", version: "2.5.0", notes: "" }],
      }),
      { releasePrs: aggregated },
    );
    expect(out).toContain("[2.5.0](https://example.test/pr/9)");
  });

  it("links an unmoved component's note to it too", () => {
    const out = body(
      projection({
        projected: [{ component: "acme-api", version: "2.5.0", notes: "" }],
        pending: [{ component: "acme-api", version: "2.5.0", notes: "" }],
      }),
      { releasePrs: aggregated },
    );
    expect(out).toContain("stays at [2.5.0](https://example.test/pr/9)");
  });

  // A repository that does separate its release pull requests can have one
  // keyed empty as well -- a root package whose branch names no component --
  // and that one belongs to that package, not to every other.
  it("does not lend an empty key to a component beside it", () => {
    const out = body(
      projection({
        projected: [{ component: "acme-api", version: "3.0.0", notes: "" }],
        pending: [{ component: "acme-api", version: "2.5.0", notes: "" }],
      }),
      {
        releasePrs: new Map([
          ["", "https://example.test/pr/9"],
          ["acme-ui", "https://example.test/pr/10"],
        ]),
      },
    );
    expect(out).toContain("| 2.5.0 |");
    expect(out).not.toContain("https://example.test/pr/9");
  });
});

// A component name is not unique across packages: two that keep their
// component out of their tags both report none, and a config can name the
// same component twice. Keyed by one package each, the second release took
// the first's current version, path and tag.
describe("two packages under one component name", () => {
  const ROOT: PackageConfig = {
    path: "api",
    component: "acme-api",
    releaseComponent: "",
    current: "2.4.1",
    separator: "-",
    includeComponent: false,
  };
  const OTHER: PackageConfig = {
    path: "ui",
    component: "acme-ui",
    releaseComponent: "",
    current: "1.0.0",
    separator: "-",
    includeComponent: false,
  };
  const both = projection({
    packages: [ROOT, OTHER],
    touched: new Map([
      ["api", ["api/src/x.ts"]],
      ["ui", ["ui/index.html"]],
    ]),
    files: ["api/src/x.ts", "ui/index.html"],
    projected: [
      { component: "", version: "2.5.0", notes: "" },
      { component: "", version: "1.1.0", notes: "" },
    ],
  });

  it("gives each release a package of its own", () => {
    const out = body(both);
    expect(out).toContain("| `acme-api` | `v2.5.0` | 2.4.1 |");
    expect(out).toContain("| `acme-ui` | `v1.1.0` | 1.0.0 |");
  });

  it("says the attribution is a guess", () => {
    expect(body(both)).toContain("release under one component name");
  });

  it("stays quiet when every component names one package", () => {
    const out = body(
      projection({
        projected: [{ component: "acme-api", version: "2.5.0", notes: "" }],
      }),
    );
    expect(out).not.toContain("release under one component name");
  });
});

// The join between a projected release and a configured package is the one
// place a wrong answer disappears instead of looking wrong: the row was
// dropped and the comment said "None", for a pull request that really does
// cut a tag. Two bugs reached it that way. It now shows what release-please
// said and says what it could not fill in.
describe("a release whose component matches no configured package", () => {
  const stray = projection({
    projected: [
      { component: "ghost", version: "3.1.0", notes: "### Features\n\n* a thing" },
    ],
  });

  it("keeps the row rather than reporting none", () => {
    const out = body(stray);
    expect(out).toContain("| `ghost` | `ghost@v3.1.0` |");
    expect(out).not.toContain("None —");
  });

  it("says which parts of the row it could not fill in", () => {
    expect(body(stray)).toContain(
      "release-please releases `ghost`, which matches no configured package",
    );
  });

  it("still names a release the configured packages do claim", () => {
    const out = body(
      projection({
        projected: [
          { component: "acme-api", version: "2.5.0", notes: "" },
          { component: "ghost", version: "3.1.0", notes: "" },
        ],
      }),
    );
    expect(out).toContain("| `acme-api` | `acme-api@v2.5.0` | 2.4.1 |");
    expect(out).toContain("| `ghost` | `ghost@v3.1.0` | — |");
  });

  it("spells an unnamed release's tag without a component", () => {
    const out = body(
      projection({ packages: [], touched: new Map(), projected: [
        { component: "", version: "1.0.0", notes: "" },
      ] }),
    );
    expect(out).toContain("`v1.0.0`");
    expect(out).toContain("a component this comment cannot name");
  });
});

// The line under the Components listing states the rule that produced it,
// and there are two rules. `splitFiles` skips a file with no `/` when
// matching prefixes, but hands a package rooted at `.` every file there is --
// so the root case needs the other sentence. Printed unconditionally, the
// wrong one appeared on every comment this action posts on its own
// repository, which releases in plain mode from `.`.
describe("the rule printed under the components listing", () => {
  const ROOT: PackageConfig = {
    path: ".",
    component: "widgets",
    releaseComponent: "",
    current: "2.4.1",
    separator: "-",
    includeComponent: false,
  };

  it("says a root file matches nothing when no package is rooted", () => {
    expect(body(projection())).toContain(
      "Longest path wins; a repository-root file matches nothing.",
    );
  });

  it("says the root package takes every file when one is", () => {
    const out = body(
      projection({
        packages: [ROOT],
        touched: new Map([[".", ["README.md"]]]),
        files: ["README.md"],
      }),
    );
    expect(out).toContain("`.` takes every file besides.");
    expect(out).not.toContain("matches nothing");
  });
});
