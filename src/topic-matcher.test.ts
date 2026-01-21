import { describe, it, expect, beforeEach } from "vitest";
import {
  compileMatcher,
  matchTopic,
  validatePublishTopic,
  splitTopic,
  joinTopic,
  clearMatcherCache,
  getMatcherCacheSize,
  getCache,
} from "./topic-matcher";

describe("topic-matcher", () => {
  beforeEach(() => {
    clearMatcherCache();
  });

  describe("compileMatcher", () => {
    it("should compile a simple topic pattern", () => {
      const matcher = compileMatcher("cart.item.add");

      expect(matcher.pattern).toBe("cart.item.add");
      expect(matcher.hasWildcards).toBe(false);
      expect(matcher.segments).toEqual([
        { type: "literal", value: "cart" },
        { type: "literal", value: "item" },
        { type: "literal", value: "add" },
      ]);
    });

    it("should evict oldest cache entry when cache size exceeds limit", () => {
      for (let i = 0; i < 1001; i++) {
        compileMatcher(`topic.${i}`);
      }

      expect(getMatcherCacheSize()).toBe(1000);
      expect(getCache().has("topic.0")).toBe(false);
    });

    it("should compile a pattern with single-level wildcard (+)", () => {
      const matcher = compileMatcher("cart.+.update");

      expect(matcher.hasWildcards).toBe(true);
      expect(matcher.segments).toEqual([
        { type: "literal", value: "cart" },
        { type: "single" },
        { type: "literal", value: "update" },
      ]);
    });

    it("should compile a pattern with multi-level wildcard (#)", () => {
      const matcher = compileMatcher("cart.#");

      expect(matcher.hasWildcards).toBe(true);
      expect(matcher.segments).toEqual([{ type: "literal", value: "cart" }, { type: "multi" }]);
    });

    it("should compile a pattern with only # wildcard", () => {
      const matcher = compileMatcher("#");

      expect(matcher.hasWildcards).toBe(true);
      expect(matcher.segments).toEqual([{ type: "multi" }]);
    });

    it("should cache compiled matchers", () => {
      compileMatcher("cart.item.add");
      expect(getMatcherCacheSize()).toBe(1);

      compileMatcher("cart.item.add");
      expect(getMatcherCacheSize()).toBe(1);

      compileMatcher("cart.item.remove");
      expect(getMatcherCacheSize()).toBe(2);

      compileMatcher("cart.item.remove");
      expect(getMatcherCacheSize()).toBe(2);
    });

    it("should throw on empty pattern", () => {
      expect(() => compileMatcher("")).toThrow("Invalid topic pattern");
    });

    it("should throw on null pattern", () => {
      expect(() => compileMatcher(null as unknown as string)).toThrow("Invalid topic pattern");
    });

    it("should throw on empty segment (double dot)", () => {
      expect(() => compileMatcher("cart..item")).toThrow(
        'Invalid topic pattern "cart..item": empty segment at position 1'
      );
    });

    it("should throw on leading dot", () => {
      expect(() => compileMatcher(".cart.item")).toThrow(
        'Invalid topic pattern ".cart.item": empty segment at position 0'
      );
    });

    it("should throw on trailing dot", () => {
      expect(() => compileMatcher("cart.item.")).toThrow(
        'Invalid topic pattern "cart.item.": empty segment at position 2'
      );
    });

    it("should throw on # not at end", () => {
      expect(() => compileMatcher("cart.#.item")).toThrow(
        'Invalid topic pattern "cart.#.item": # wildcard must be at the end'
      );
    });

    it("should throw on invalid characters", () => {
      expect(() => compileMatcher("cart.item@add")).toThrow(
        'Invalid topic pattern "cart.item@add": segment "item@add" contains invalid characters. Use alphanumeric, hyphen, or underscore only.'
      );
      expect(() => compileMatcher("cart.item/add")).toThrow(
        'Invalid topic pattern "cart.item/add": segment "item/add" contains invalid characters. Use alphanumeric, hyphen, or underscore only.'
      );
      expect(() => compileMatcher("cart.item add")).toThrow(
        'Invalid topic pattern "cart.item add": segment "item add" contains invalid characters. Use alphanumeric, hyphen, or underscore only.'
      );
    });

    it("should allow hyphens in segments", () => {
      const matcher = compileMatcher("cart.item-add");

      expect(matcher.segments[1]).toEqual({ type: "literal", value: "item-add" });
    });

    it("should allow underscores in segments", () => {
      const matcher = compileMatcher("cart.item_add");

      expect(matcher.segments[1]).toEqual({ type: "literal", value: "item_add" });
    });

    it("should allow numbers in segments", () => {
      const matcher = compileMatcher("v2.cart.item");

      expect(matcher.segments[0]).toEqual({ type: "literal", value: "v2" });
    });
  });

  describe("matchTopic", () => {
    describe("exact matching (no wildcards)", () => {
      it("should match identical topics", () => {
        const matcher = compileMatcher("cart.item.add");

        expect(matchTopic("cart.item.add", matcher)).toBe(true);
      });

      it("should not match different topics", () => {
        const matcher = compileMatcher("cart.item.add");

        expect(matchTopic("cart.item.remove", matcher)).toBe(false);
        expect(matchTopic("cart.item", matcher)).toBe(false);
        expect(matchTopic("cart.item.add.extra", matcher)).toBe(false);
      });
    });

    describe("single-level wildcard (+)", () => {
      it("should match single segment at wildcard position", () => {
        const matcher = compileMatcher("cart.+.update");

        expect(matchTopic("cart.item.update", matcher)).toBe(true);
        expect(matchTopic("cart.promo.update", matcher)).toBe(true);
        expect(matchTopic("cart.123.update", matcher)).toBe(true);
      });

      it("should not match multiple segments at wildcard position", () => {
        const matcher = compileMatcher("cart.+.update");

        expect(matchTopic("cart.item.detail.update", matcher)).toBe(false);
      });

      it("should not match zero segments at wildcard position", () => {
        const matcher = compileMatcher("cart.+.update");

        expect(matchTopic("cart.update", matcher)).toBe(false);
      });

      it("should work with multiple single wildcards", () => {
        const matcher = compileMatcher("+.+.update");

        expect(matchTopic("cart.item.update", matcher)).toBe(true);
        expect(matchTopic("user.profile.update", matcher)).toBe(true);
        expect(matchTopic("cart.item.detail.update", matcher)).toBe(false);
      });

      it("should work with leading wildcard", () => {
        const matcher = compileMatcher("+.item.add");

        expect(matchTopic("cart.item.add", matcher)).toBe(true);
        expect(matchTopic("wishlist.item.add", matcher)).toBe(true);
      });

      it("should work with trailing wildcard", () => {
        const matcher = compileMatcher("cart.item.+");

        expect(matchTopic("cart.item.add", matcher)).toBe(true);
        expect(matchTopic("cart.item.remove", matcher)).toBe(true);
        expect(matchTopic("cart.item.update", matcher)).toBe(true);
      });
    });

    describe("multi-level wildcard (#)", () => {
      it("should match zero segments after #", () => {
        const matcher = compileMatcher("cart.#");
        // MQTT spec: # matches zero or more segments
        // "cart.#" should match "cart" (zero additional segments)
        expect(matchTopic("cart", matcher)).toBe(true);
      });

      it("should match one segment after #", () => {
        const matcher = compileMatcher("cart.#");

        expect(matchTopic("cart.item", matcher)).toBe(true);
      });

      it("should match multiple segments after #", () => {
        const matcher = compileMatcher("cart.#");

        expect(matchTopic("cart.item.add", matcher)).toBe(true);
        expect(matchTopic("cart.item.detail.update", matcher)).toBe(true);
        expect(matchTopic("cart.checkout.start", matcher)).toBe(true);
      });

      it("should match everything with just #", () => {
        const matcher = compileMatcher("#");

        expect(matchTopic("cart", matcher)).toBe(true);
        expect(matchTopic("cart.item", matcher)).toBe(true);
        expect(matchTopic("cart.item.add", matcher)).toBe(true);
        expect(matchTopic("user.profile.settings.theme", matcher)).toBe(true);
      });

      it("should not match topics outside the prefix", () => {
        const matcher = compileMatcher("cart.#");

        expect(matchTopic("user.item.add", matcher)).toBe(false);
        expect(matchTopic("carts.item.add", matcher)).toBe(false); // Different root
      });
    });

    describe("combined patterns", () => {
      it("should handle + followed by #", () => {
        const matcher = compileMatcher("cart.+.#");

        expect(matchTopic("cart.item.add", matcher)).toBe(true);
        expect(matchTopic("cart.item.detail.update", matcher)).toBe(true);
        expect(matchTopic("cart.promo.start", matcher)).toBe(true);
      });
    });
  });

  describe("validatePublishTopic", () => {
    it("should accept valid topics", () => {
      expect(() => validatePublishTopic("cart")).not.toThrow();
      expect(() => validatePublishTopic("cart.item")).not.toThrow();
      expect(() => validatePublishTopic("cart.item.add")).not.toThrow();
      expect(() => validatePublishTopic("v2.cart.item-add")).not.toThrow();
    });

    it("should reject topics with + wildcard", () => {
      expect(() => validatePublishTopic("cart.+.add")).toThrow("wildcards");
    });

    it("should reject topics with # wildcard", () => {
      expect(() => validatePublishTopic("cart.#")).toThrow("wildcards");
    });

    it("should reject empty topics", () => {
      expect(() => validatePublishTopic("")).toThrow("Invalid topic");
    });

    it("should reject topics with empty segments", () => {
      expect(() => validatePublishTopic("cart..item")).toThrow("empty segment");
    });

    it("should reject topics with invalid characters", () => {
      expect(() => validatePublishTopic("cart.item@add")).toThrow("invalid characters");
    });
  });

  describe("utilities", () => {
    it("should splitTopic splits on dots", () => {
      expect(splitTopic("cart.item.add")).toEqual(["cart", "item", "add"]);
      expect(splitTopic("cart")).toEqual(["cart"]);
    });

    it("should joinTopic join with dots", () => {
      expect(joinTopic("cart", "item", "add")).toBe("cart.item.add");
      expect(joinTopic("cart")).toBe("cart");
    });
  });
});
