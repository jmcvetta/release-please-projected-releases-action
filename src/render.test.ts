import { describe, expect, it } from "vitest";
import type { PackageConfig, Projection } from "./project.js";
import { tagFor } from "./project.js";
import { bumpLevel, footer, render } from "./render.js";

const API: PackageConfig = {
  path: "api",
  component: "acme-api",
  current: "2.4.1",
  separator: "@",
  includeComponent: true,
};
const UI: PackageConfig = {
  path: "ui",
  component: "acme-ui",
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
    expect(out).toContain("stays at 2.5.0, already pending");
    expect(out).not.toContain("**2.5.0**");
  });

  // The feature does ship, in the notes of the version already pending.
  it("credits a visible type with the changelog line it adds", () => {
    const out = body(absorbed, { title: "feat: another feature" });
    expect(out).toContain("this PR adds a changelog line to it, not a version.");
    expect(out).not.toContain("adds no changelog line");
  });

  it("tells a hidden type that it contributes nothing", () => {
    const out = body(absorbed, { title: "docs: a note" });
    expect(out).toContain("`docs` adds no changelog line and changes no version.");
    expect(out).toContain("this PR does not move it.");
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
