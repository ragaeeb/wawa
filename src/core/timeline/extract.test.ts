import { describe, expect, it } from "bun:test";
import { extractTimeline } from "./extract";

describe("timeline extraction", () => {
  it("should extract tweets from user timeline_v2 structure and cursor", () => {
    const data = {
      data: {
        user: {
          result: {
            timeline_v2: {
              timeline: {
                instructions: [
                  {
                    type: "TimelineAddEntries",
                    entries: [
                      {
                        entryId: "tweet-1",
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                __typename: "Tweet",
                                rest_id: "1",
                                legacy: { full_text: "hello" },
                              },
                            },
                          },
                        },
                      },
                      {
                        entryId: "cursor-bottom-0",
                        content: {
                          cursorType: "Bottom",
                          value: "CURSOR_123",
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    };

    const result = extractTimeline(data, (tweet, type) => ({ id: tweet.rest_id, type }));

    expect(result.items).toEqual([{ id: "1", type: "Tweet" }]);
    expect(result.nextCursor).toBe("CURSOR_123");
  });

  it("should extract search timeline path", () => {
    const data = {
      data: {
        search_by_raw_query: {
          search_timeline: {
            timeline: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    {
                      entryId: "tweet-2",
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              __typename: "Tweet",
                              rest_id: "2",
                              legacy: {
                                full_text: "search tweet",
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    };

    const result = extractTimeline(data, (tweet) => ({ id: tweet.rest_id }));
    expect(result.items).toEqual([{ id: "2" }]);
    expect(result.nextCursor).toBeNull();
  });
});
