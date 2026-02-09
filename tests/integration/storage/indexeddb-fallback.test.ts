import { beforeEach, describe, expect, it } from "bun:test";
import { indexedDB as fakeIndexedDb } from "fake-indexeddb";
import { buildResumePayload } from "../../../src/core/resume/payload";
import { createResumeStorage, type FallbackStorage } from "../../../src/core/resume/storage";
import { STORAGE_KEYS } from "../../../src/platform/chrome/storage-keys";

class MemoryFallbackStorage implements FallbackStorage {
  private readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

beforeEach(() => {
  // fake-indexeddb handles isolated state per DB name in this test context.
});

describe("resume storage integration", () => {
  it("should persist and restore using IndexedDB primary path", async () => {
    const fallback = new MemoryFallbackStorage();
    const storage = createResumeStorage({
      indexedDbFactory: fakeIndexedDb,
      fallbackStorage: fallback,
    });

    const payload = buildResumePayload({
      username: "example",
      tweets: [{ id: "1" }],
      meta: null,
      savedAt: Date.now(),
    });

    expect(await storage.persist(payload)).toBe(true);

    const restored = await storage.restore("example");
    expect(restored?.tweets).toHaveLength(1);
    expect(restored?.username).toBe("example");
  });

  it("should fall back when IndexedDB is unavailable", async () => {
    const fallback = new MemoryFallbackStorage();
    const storage = createResumeStorage({
      indexedDbFactory: undefined,
      fallbackStorage: fallback,
    });

    const payload = buildResumePayload({
      username: "example",
      tweets: [{ id: "2" }],
      meta: null,
      savedAt: Date.now(),
    });

    expect(await storage.persist(payload)).toBe(true);

    const restored = await storage.restore("example");
    expect(restored?.tweets[0]?.id).toBe("2");
  });

  it("should fall back when IndexedDB write throws and still restore", async () => {
    const fallback = new MemoryFallbackStorage();
    const brokenIndexedDb = {
      open() {
        throw new Error("Quota exceeded");
      },
    } as unknown as IDBFactory;

    const storage = createResumeStorage({
      indexedDbFactory: brokenIndexedDb,
      fallbackStorage: fallback,
    });

    const payload = buildResumePayload({
      username: "example",
      tweets: [{ id: "broken-idb" }],
      meta: null,
      savedAt: Date.now(),
    });

    expect(await storage.persist(payload)).toBe(true);
    const restored = await storage.restore("example");
    expect(restored?.tweets[0]?.id).toBe("broken-idb");
  });

  it("should chunk oversized fallback payloads and restore them losslessly", async () => {
    const fallback = new MemoryFallbackStorage();
    const storage = createResumeStorage({
      indexedDbFactory: undefined,
      fallbackStorage: fallback,
    });

    const largeText = "x".repeat(700_000);
    const payload = buildResumePayload({
      username: "example",
      tweets: [{ id: "large", text: largeText }],
      meta: null,
      savedAt: Date.now(),
    });

    expect(await storage.persist(payload)).toBe(true);
    const manifest = await fallback.get<{ version: number; chunkCount: number }>(
      STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK,
    );

    expect(manifest?.version).toBe(2);
    expect((manifest?.chunkCount ?? 0) > 1).toBe(true);

    const restored = await storage.restore("example");
    expect(restored?.tweets[0]?.id).toBe("large");
    expect(restored?.tweets[0]?.text).toBe(largeText);
  });

  it("should clear persisted payload from both stores", async () => {
    const fallback = new MemoryFallbackStorage();
    const storage = createResumeStorage({
      indexedDbFactory: fakeIndexedDb,
      fallbackStorage: fallback,
    });

    const payload = buildResumePayload({
      username: "example",
      tweets: [{ id: "3" }],
      meta: null,
      savedAt: Date.now(),
    });

    await storage.persist(payload);
    await storage.clear();

    const restored = await storage.restore("example");
    expect(restored).toBeNull();
  });
});
