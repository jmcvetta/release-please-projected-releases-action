import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  boolInput,
  error,
  input,
  inputOr,
  listInput,
  notice,
  readEvent,
  setOutput,
  summary,
  warning,
} from "./runner.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** written captures what a call writes to stdout, which is where the runner
 * reads workflow commands from. */
function written(write: () => void): string {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  write();
  vi.restoreAllMocks();
  return chunks.join("");
}

const tmp = () => mkdtempSync(join(tmpdir(), "projected-releases-"));

describe("input", () => {
  it("reads the runner's INPUT_ convention", () => {
    expect(input("head-sha", { "INPUT_HEAD-SHA": "abc" })).toBe("abc");
  });

  it("uppercases and turns spaces into underscores, and nothing else", () => {
    expect(input("a b-c", { "INPUT_A_B-C": "x" })).toBe("x");
  });

  it("trims, because a YAML block scalar carries a trailing newline", () => {
    expect(input("mode", { INPUT_MODE: " render\n" })).toBe("render");
  });

  it("is empty for an input the caller left out", () => {
    expect(input("nope", {})).toBe("");
    expect(inputOr("nope", "fallback", {})).toBe("fallback");
  });
});

describe("boolInput", () => {
  it("reads true and false in any case", () => {
    expect(boolInput("x", false, { INPUT_X: "TRUE" })).toBe(true);
    expect(boolInput("x", true, { INPUT_X: "False" })).toBe(false);
  });

  it("falls back when unset", () => {
    expect(boolInput("x", true, {})).toBe(true);
  });

  it("refuses a value that is neither", () => {
    expect(() => boolInput("x", true, { INPUT_X: "yes" })).toThrow(/true or false/);
  });
});

describe("listInput", () => {
  it("splits on commas, spaces and newlines alike", () => {
    expect(listInput("t", { INPUT_T: "feat, fix\nperf" })).toEqual([
      "feat",
      "fix",
      "perf",
    ]);
  });

  it("distinguishes an unset list from an empty one", () => {
    // Undefined means "resolve them from somewhere else"; an empty array
    // would mean "this repository recognizes no types at all".
    expect(listInput("t", {})).toBeUndefined();
  });
});

describe("setOutput", () => {
  it("writes the delimited form, which can carry a newline", () => {
    const file = join(tmp(), "out");
    writeFileSync(file, "");
    setOutput("body", "line one\nline two", { GITHUB_OUTPUT: file });
    const written = readFileSync(file, "utf8");
    expect(written).toMatch(/^body<<ghadelimiter_/);
    expect(written).toContain("line one\nline two\n");
  });

  it("does nothing when the runner gave no output file", () => {
    expect(() => setOutput("body", "x", {})).not.toThrow();
  });
});

describe("summary", () => {
  it("appends to the run's job summary", () => {
    const file = join(tmp(), "summary");
    summary("## one", { GITHUB_STEP_SUMMARY: file });
    summary("## two", { GITHUB_STEP_SUMMARY: file });
    expect(readFileSync(file, "utf8")).toBe("## one\n## two\n");
  });

  it("does nothing when the runner has no summary", () => {
    expect(() => summary("## one", {})).not.toThrow();
  });
});

describe("annotations", () => {
  it("writes one workflow command per level", () => {
    expect(written(() => notice("created"))).toBe("::notice::created\n");
    expect(written(() => warning("careful"))).toBe("::warning::careful\n");
    expect(written(() => error("broken"))).toBe("::error::broken\n");
  });

  it("escapes the three characters the command syntax cannot carry", () => {
    // A newline would end the command, and a bare `%` would be read as the
    // start of one of these escapes. The action's warnings are whole
    // paragraphs, so both arise.
    expect(written(() => warning("100% done\r\nor not"))).toBe(
      "::warning::100%25 done%0D%0Aor not\n",
    );
  });
});

describe("readEvent", () => {
  const write = (payload: unknown): string => {
    const file = join(tmp(), "event.json");
    writeFileSync(file, JSON.stringify(payload));
    return file;
  };

  it("reads the pull request out of the webhook payload", () => {
    const file = write({
      pull_request: {
        number: 12,
        title: "feat: a thing",
        body: "why",
        commits: 3,
        base: { ref: "master" },
        head: { sha: "abc", ref: "topic", repo: { full_name: "acme/widgets" } },
      },
    });
    expect(readEvent({ GITHUB_EVENT_PATH: file })).toEqual({
      number: 12,
      title: "feat: a thing",
      body: "why",
      commits: 3,
      base: "master",
      headSha: "abc",
      headBranch: "topic",
      headRepo: "acme/widgets",
    });
  });

  it("drops a null body rather than carrying it through", () => {
    // GitHub sends `"body": null` for a pull request opened with no
    // description, and the commit body has to be a string.
    const file = write({ pull_request: { number: 1, body: null } });
    expect(readEvent({ GITHUB_EVENT_PATH: file })).toEqual({ number: 1 });
  });

  it("is empty for an event with no pull request", () => {
    // A `workflow_run` job legitimately has none; the inputs supply it.
    expect(readEvent({ GITHUB_EVENT_PATH: write({ action: "completed" }) })).toEqual({});
  });

  it("is empty rather than raising when the payload is missing or broken", () => {
    expect(readEvent({})).toEqual({});
    expect(readEvent({ GITHUB_EVENT_PATH: "/nonexistent/event.json" })).toEqual({});
  });
});
