import { describe, expect, it } from "bun:test";
import { extractTweetsFromExportData, parseResumeInput, parseTweetDate } from "./payload";

describe("resume payload parsing", () => {
  it("should accept items array format", () => {
    const tweets = extractTweetsFromExportData({ items: [{ id: "1" }] });
    expect(tweets).toEqual([{ id: "1" }]);
  });

  it("should accept tweets array format", () => {
    const tweets = extractTweetsFromExportData({ tweets: [{ id: "2" }] });
    expect(tweets).toEqual([{ id: "2" }]);
  });

  it("should accept root array format", () => {
    const tweets = extractTweetsFromExportData([{ id: "3" }]);
    expect(tweets).toEqual([{ id: "3" }]);
  });

  it("should extract username from meta payload", () => {
    const parsed = parseResumeInput({
      meta: {
        username: "@ExampleUser",
      },
      items: [{ id: "1" }],
    });

    expect(parsed.username).toBe("exampleuser");
    expect(parsed.tweets).toHaveLength(1);
  });

  it("should parse custom TwExport date string", () => {
    const parsed = parseTweetDate("2014-01-29 06:15:43");
    expect(parsed?.toISOString()).toBe("2014-01-29T06:15:43.000Z");
  });

  it("should return null for invalid dates", () => {
    expect(parseTweetDate("not-a-date")).toBeNull();
  });
});
