import { Effect } from "effect"
import { Services } from "homelab-services"
import { describe, expect, it } from "vitest"
import { TAILOR_ENTRIES_STORAGE_KEY, TailorEntryStoreServiceLive } from "../src/layers/tailor-entry-store-service.js"
import type { WebStoragePort } from "../src/web-storage-port.js"

/**
 * In-memory WebStoragePort stub for testing.
 * No jsdom, no real localStorage - just a Map-backed implementation.
 */
class InMemoryStorage implements WebStoragePort {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }
}

describe("TailorEntryStoreService", () => {
  const makeService = () => {
    const storage = new InMemoryStorage()
    const layer = TailorEntryStoreServiceLive(storage)
    return { storage, layer }
  }

  it("should return empty array when storage is empty", async () => {
    const { layer } = makeService()
    const program = Effect.gen(function*() {
      const service = yield* Services.TailorEntryStoreService.TailorEntryStoreService
      return yield* service.load()
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(result).toEqual([])
  })

  it("should save and load entries (envelope roundtrip)", async () => {
    const { layer, storage } = makeService()
    const now = Date.now()
    const entries = [
      {
        id: "test-1",
        status: "success" as const,
        createdAt: now,
        listingText: "We're looking for a TypeScript engineer...",
        jobTitle: "Software Engineer",
        company: "Acme Corp",
        fit: {
          verdict: "strong" as const,
          summary: "Strong match with relevant experience",
          tips: [
            {
              category: "requirements-inflation" as const,
              severity: "info" as const,
              title: "Add TypeScript details",
              detail: "Expand on TypeScript experience",
              evidence: "We need TypeScript",
            },
          ],
          keywordCoverage: {
            required: ["TypeScript", "React"],
            matched: ["TypeScript"],
            missing: ["React"],
          },
        },
        contentPatch: "eyJ0eXBlIjoicmVwbGFjZSIsInBhdGgiOiIvaGVhZGluZy9uYW1lIiwidmFsdWUiOiJKb2huIn0=",
        baseVersion: "1.0.0",
        meta: {
          stage1: {
            model: "gpt-4-turbo",
            tokens: { input: 1500, output: 500 },
            latencyMs: 2000,
          },
          stage2: {
            model: "claude-3-opus",
            tokens: { input: 3000, output: 1500 },
            latencyMs: 5000,
          },
          degraded: false,
          cacheHit: false,
          contentHash: "abc123",
          listingHash: "def456",
          promptVersion: "v1",
          schemaVersion: "1.0",
        },
        error: null,
      },
    ]

    const program = Effect.gen(function*() {
      const service = yield* Services.TailorEntryStoreService.TailorEntryStoreService
      yield* service.save(entries)
      return yield* service.load()
    })

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))

    // Debug: log storage contents
    console.log("Storage contents:", storage.getItem(TAILOR_ENTRIES_STORAGE_KEY))
    console.log("Result:", JSON.stringify(result, null, 2))

    expect(result).toEqual(entries)
  })

  it("should return empty array on corrupt storage data", async () => {
    const { layer, storage } = makeService()
    storage.setItem(TAILOR_ENTRIES_STORAGE_KEY, "not valid json")

    const program = Effect.gen(function*() {
      const service = yield* Services.TailorEntryStoreService.TailorEntryStoreService
      return yield* service.load()
    })

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(result).toEqual([])
  })

  it("should prune entries to keep newest 50", async () => {
    const { layer } = makeService()
    const now = Date.now()

    // Create 60 entries with different timestamps
    const entries = Array.from({ length: 60 }, (_, i) => ({
      id: `entry-${i}`,
      status: "success" as const,
      createdAt: now - (60 - i) * 1000, // Older entries first
      listingText: `Listing ${i}`,
      jobTitle: `Job ${i}`,
      company: `Company ${i}`,
      fit: null,
      contentPatch: null,
      baseVersion: "1.0.0",
      meta: null,
      error: null,
    }))

    const program = Effect.gen(function*() {
      const service = yield* Services.TailorEntryStoreService.TailorEntryStoreService
      yield* service.save(entries)
      return yield* service.load()
    })

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))

    // Should have exactly 50 entries (pruned from 60)
    expect(result.length).toBe(50)

    // Should keep the newest 50 (entries 10-59, since entry 0 is oldest)
    const ids = result.map((e) => e.id)
    for (let i = 10; i < 60; i++) {
      expect(ids).toContain(`entry-${i}`)
    }
    // Should not contain the oldest 10
    for (let i = 0; i < 10; i++) {
      expect(ids).not.toContain(`entry-${i}`)
    }
  })

  it("should handle schema version mismatch gracefully", async () => {
    const { layer, storage } = makeService()

    // Store data with wrong schema version
    const badData = {
      version: 999, // Wrong version
      entries: [],
    }
    storage.setItem(TAILOR_ENTRIES_STORAGE_KEY, JSON.stringify(badData))

    const program = Effect.gen(function*() {
      const service = yield* Services.TailorEntryStoreService.TailorEntryStoreService
      return yield* service.load()
    })

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(result).toEqual([])
  })
})
