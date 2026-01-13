import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateClientId, getOrCreateClientId, isValidClientId, clearClientId } from "./client-id";

describe("Client ID Generation", () => {
  describe("GenerateClientId", () => {
    it("should generate a valid UUID when crypto.randomUUID is available", () => {
      const id = generateClientId();

      expect(id).toBeTruthy();
      expect(typeof id).toBe("string");
      expect(isValidClientId(id)).toBe(true);
    });

    it("should generate unique IDs on each call", () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        ids.add(generateClientId());
      }

      // All IDs should be unique
      expect(ids.size).toBe(100);
    });

    it("should generate RFC 4122 v4 UUID format when crypto is available", () => {
      const id = generateClientId();
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      expect(uuidPattern.test(id)).toBe(true);
    });

    it("should fallback gracefully when crypto.randomUUID is unavailable", () => {
      const originalCrypto = globalThis.crypto;
      const originalRandomUUID = globalThis.crypto?.randomUUID;

      try {
        if (globalThis.crypto) {
          (globalThis.crypto as { randomUUID?: unknown }).randomUUID = undefined;
        }

        const id = generateClientId();

        expect(id).toBeTruthy();
        expect(typeof id).toBe("string");
        expect(id).toMatch(/^cid-[0-9a-z]+-[0-9a-z]+$/);
        expect(isValidClientId(id)).toBe(true);
      } finally {
        if (originalCrypto && originalRandomUUID) {
          (globalThis.crypto as { randomUUID?: unknown }).randomUUID = originalRandomUUID;
        }
      }
    });

    it("should fallback when crypto.randomUUID throws", () => {
      const originalRandomUUID = globalThis.crypto?.randomUUID;

      try {
        if (globalThis.crypto) {
          (globalThis.crypto as { randomUUID?: unknown }).randomUUID = () => {
            throw new Error("Not available");
          };
        }

        const id = generateClientId();

        expect(id).toBeTruthy();
        expect(id).toMatch(/^cid-[0-9a-z]+-[0-9a-z]+$/);
      } finally {
        if (originalRandomUUID) {
          (globalThis.crypto as { randomUUID?: unknown }).randomUUID = originalRandomUUID;
        }
      }
    });

    it("should generate fallback IDs with sufficient entropy", () => {
      const originalRandomUUID = globalThis.crypto?.randomUUID;

      try {
        if (globalThis.crypto) {
          delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
        }

        const ids = new Set<string>();

        for (let i = 0; i < 100; i++) {
          ids.add(generateClientId());
        }

        expect(ids.size).toBe(100);
      } finally {
        if (originalRandomUUID) {
          (globalThis.crypto as { randomUUID?: unknown }).randomUUID = originalRandomUUID;
        }
      }
    });
  });

  describe("IsValidClientId", () => {
    it("should accept valid RFC 4122 v4 UUIDs", () => {
      const validUUIDs = [
        "550e8400-e29b-41d4-a716-446655440000",
        "e2208bff-4d4f-4554-bfda-328f9ccc7405",
        "0977f47f-d93d-4020-8b7f-e216fa9cf5e5",
        "b01731a5-62e5-424b-878a-9453dc941d31",
      ];

      validUUIDs.forEach((uuid) => {
        expect(isValidClientId(uuid)).toBe(true);
      });
    });

    it("should accept valid fallback format", () => {
      const validFallbackIds = ["cid-abc123-xyz789", "cid-1234567890-abcdefghij", "cid-k0-l0"];

      validFallbackIds.forEach((id) => {
        expect(isValidClientId(id)).toBe(true);
      });
    });

    it("should reject invalid formats", () => {
      const invalidIds = [
        "",
        "invalid",
        "123",
        "cid-",
        "cid-abc",
        "cid-abc-",
        "not-a-uuid",
        "550e8400-e29b-41d4-a716", // incomplete UUID
        "550e8400-e29b-51d4-a716-446655440000", // wrong version (5 instead of 4)
        null,
        undefined,
        123,
        {},
      ];

      invalidIds.forEach((id) => {
        expect(isValidClientId(id as string)).toBe(false);
      });
    });

    it("should be case-insensitive for UUIDs", () => {
      expect(isValidClientId("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
      expect(isValidClientId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    });
  });

  describe("GetOrCreateClientId", () => {
    let mockStorage: Storage;

    beforeEach(() => {
      const store = new Map<string, string>();
      mockStorage = {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => store.set(key, value)),
        removeItem: vi.fn((key: string) => store.delete(key)),
        clear: vi.fn(() => store.clear()),
        key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
        get length() {
          return store.size;
        },
      };
    });

    it("should generate and store a new ID on first call", () => {
      const id = getOrCreateClientId(mockStorage);

      expect(id).toBeTruthy();
      expect(isValidClientId(id)).toBe(true);
      expect(mockStorage.setItem).toHaveBeenCalledWith("__pubsub_mfe_client_id__", id);
    });

    it("should return the same ID on subsequent calls", () => {
      const id1 = getOrCreateClientId(mockStorage);
      const id2 = getOrCreateClientId(mockStorage);
      const id3 = getOrCreateClientId(mockStorage);

      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
    });

    it("should reuse existing valid ID from storage", () => {
      const existingId = "550e8400-e29b-41d4-a716-446655440000";
      mockStorage.setItem("__pubsub_mfe_client_id__", existingId);

      const id = getOrCreateClientId(mockStorage);

      expect(id).toBe(existingId);
    });

    it("should regenerate ID if stored ID is invalid", () => {
      mockStorage.setItem("__pubsub_mfe_client_id__", "invalid-id");

      const id = getOrCreateClientId(mockStorage);

      expect(id).not.toBe("invalid-id");
      expect(isValidClientId(id)).toBe(true);
    });

    it("should handle storage errors gracefully", () => {
      const errorStorage = {
        getItem: vi.fn(() => {
          throw new Error("Storage error");
        }),
        setItem: vi.fn(() => {
          throw new Error("Storage error");
        }),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      };
      const id = getOrCreateClientId(errorStorage);

      expect(id).toBeTruthy();
      expect(isValidClientId(id)).toBe(true);
    });

    it("should handle quota exceeded errors", () => {
      const quotaStorage = {
        getItem: vi.fn(() => null),
        setItem: vi.fn(() => {
          const error = new Error("QuotaExceededError");
          error.name = "QuotaExceededError";
          throw error;
        }),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      };
      const id = getOrCreateClientId(quotaStorage);

      expect(id).toBeTruthy();
      expect(isValidClientId(id)).toBe(true);
    });

    it("should work with different storage implementations", () => {
      const memoryStore = new Map<string, string>();
      const customStorage: Storage = {
        getItem: (key) => memoryStore.get(key) ?? null,
        setItem: (key, value) => memoryStore.set(key, value),
        removeItem: (key) => memoryStore.delete(key),
        clear: () => memoryStore.clear(),
        key: (index) => Array.from(memoryStore.keys())[index] ?? null,
        get length() {
          return memoryStore.size;
        },
      };

      const id1 = getOrCreateClientId(customStorage);
      const id2 = getOrCreateClientId(customStorage);

      expect(id1).toBe(id2);
    });
  });

  describe("ClearClientId", () => {
    let mockStorage: Storage;

    beforeEach(() => {
      const store = new Map<string, string>();
      mockStorage = {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => store.set(key, value)),
        removeItem: vi.fn((key: string) => store.delete(key)),
        clear: vi.fn(() => store.clear()),
        key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
        get length() {
          return store.size;
        },
      };
    });

    it("should remove stored client ID", () => {
      const id = getOrCreateClientId(mockStorage);
      expect(mockStorage.getItem("__pubsub_mfe_client_id__")).toBe(id);

      clearClientId(mockStorage);

      expect(mockStorage.removeItem).toHaveBeenCalledWith("__pubsub_mfe_client_id__");
    });

    it("should cause getOrCreateClientId to generate new ID after clear", () => {
      const id1 = getOrCreateClientId(mockStorage);

      clearClientId(mockStorage);

      const id2 = getOrCreateClientId(mockStorage);

      expect(id1).not.toBe(id2);
    });

    it("should handle storage errors gracefully", () => {
      const errorStorage = {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(() => {
          throw new Error("Storage error");
        }),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      };

      expect(() => clearClientId(errorStorage)).not.toThrow();
    });

    it("should be safe to call when no ID is stored", () => {
      expect(() => clearClientId(mockStorage)).not.toThrow();
      expect(mockStorage.removeItem).toHaveBeenCalledWith("__pubsub_mfe_client_id__");
    });
  });

  describe("Integration scenarios", () => {
    let mockStorage: Storage;

    beforeEach(() => {
      const store = new Map<string, string>();
      mockStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() {
          return store.size;
        },
      };
    });

    it("should simulate tab persistence across page reloads", () => {
      // First page load
      const id1 = getOrCreateClientId(mockStorage);

      // Simulate page reload (same tab, storage persists)
      const id2 = getOrCreateClientId(mockStorage);

      expect(id1).toBe(id2);
    });

    it("should generate different IDs for different tabs", () => {
      // Simulate two different tabs with separate storage
      const storage1 = new Map<string, string>();
      const storage2 = new Map<string, string>();

      const mockStorage1: Storage = {
        getItem: (key) => storage1.get(key) ?? null,
        setItem: (key, value) => storage1.set(key, value),
        removeItem: (key) => storage1.delete(key),
        clear: () => storage1.clear(),
        key: (index) => Array.from(storage1.keys())[index] ?? null,
        get length() {
          return storage1.size;
        },
      };

      const mockStorage2: Storage = {
        getItem: (key) => storage2.get(key) ?? null,
        setItem: (key, value) => storage2.set(key, value),
        removeItem: (key) => storage2.delete(key),
        clear: () => storage2.clear(),
        key: (index) => Array.from(storage2.keys())[index] ?? null,
        get length() {
          return storage2.size;
        },
      };

      const tab1Id = getOrCreateClientId(mockStorage1);
      const tab2Id = getOrCreateClientId(mockStorage2);

      expect(tab1Id).not.toBe(tab2Id);
    });

    it("should handle rapid concurrent calls", () => {
      const ids = Array.from({ length: 10 }, () => getOrCreateClientId(mockStorage));

      // All should be the same (stored ID)
      expect(new Set(ids).size).toBe(1);
    });

    it("should handle clear and regenerate cycle", () => {
      const ids = new Set<string>();

      for (let i = 0; i < 5; i++) {
        const id = getOrCreateClientId(mockStorage);
        ids.add(id);
        clearClientId(mockStorage);
      }

      // Each cycle should generate a new unique ID
      expect(ids.size).toBe(5);
    });
  });

  describe("Browser compatibility", () => {
    it("should handle environments without crypto API", () => {
      const originalCrypto = globalThis.crypto;

      try {
        delete (globalThis as { crypto?: unknown }).crypto;

        const id = generateClientId();

        expect(id).toBeTruthy();
        expect(isValidClientId(id)).toBe(true);
      } finally {
        if (originalCrypto) {
          (globalThis as { crypto?: unknown }).crypto = originalCrypto;
        }
      }
    });
  });
});
