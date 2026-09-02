import { describe, expect, it } from "vitest";
import type { Client, IssueComment } from "./api.js";
import { findSticky, markerFor, stick, withMarker } from "./comment.js";

/** fakeClient records what a stick() does, without an API. */
function fakeClient(existing: IssueComment[]): {
  client: Client;
  created: string[];
  updated: { id: number; body: string }[];
} {
  const created: string[] = [];
  const updated: { id: number; body: string }[] = [];
  const client = {
    async issueComments() {
      return existing;
    },
    async createComment(_number: number, body: string) {
      created.push(body);
      return { id: 99, body };
    },
    async updateComment(id: number, body: string) {
      updated.push({ id, body });
      return { id, body };
    },
  } as unknown as Client;
  return { client, created, updated };
}

describe("withMarker", () => {
  it("prefixes the hidden marker", () => {
    expect(withMarker("h", "body")).toBe(`${markerFor("h")}\nbody`);
  });

  it("does not prefix twice", () => {
    const once = withMarker("h", "body");
    expect(withMarker("h", once)).toBe(once);
  });
});

describe("findSticky", () => {
  it("matches on the marker, not on authorship or recency", () => {
    // The point of the marker: a repository whose CI leaves its own comment
    // under the same bot identity would collide with "my newest comment".
    const comments = [
      { id: 1, body: "coverage went up" },
      { id: 2, body: `${markerFor("projected-releases")}\nold projection` },
      { id: 3, body: "someone's review" },
    ];
    expect(findSticky(comments, "projected-releases")?.id).toBe(2);
  });

  it("does not match a different header's comment", () => {
    const comments = [{ id: 1, body: `${markerFor("other")}\nx` }];
    expect(findSticky(comments, "projected-releases")).toBeUndefined();
  });
});

describe("stick", () => {
  it("creates the comment when there is none", async () => {
    const { client, created, updated } = fakeClient([]);
    expect(await stick(client, 7, "h", "hello")).toEqual({
      action: "created",
      id: 99,
    });
    expect(created).toEqual([withMarker("h", "hello")]);
    expect(updated).toEqual([]);
  });

  it("edits the existing comment in place", async () => {
    const { client, created, updated } = fakeClient([
      { id: 4, body: withMarker("h", "old") },
    ]);
    expect(await stick(client, 7, "h", "new")).toEqual({
      action: "updated",
      id: 4,
    });
    expect(created).toEqual([]);
    expect(updated).toEqual([{ id: 4, body: withMarker("h", "new") }]);
  });

  it("writes nothing when the body is unchanged", async () => {
    const { client, created, updated } = fakeClient([
      { id: 4, body: withMarker("h", "same") },
    ]);
    expect(await stick(client, 7, "h", "same")).toEqual({
      action: "unchanged",
      id: 4,
    });
    expect(created).toEqual([]);
    expect(updated).toEqual([]);
  });
});
