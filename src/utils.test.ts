import { describe, it, expect } from "vitest";
import {
  // Prototype pollution prevention
  isDangerousProperty,
  hasOwnProperty,
  // Type guards
  isPlainObject,
  // Safe config parsing
  safePick,
} from "./utils";

describe("utils", () => {
  describe("isDangerousProperty", () => {
    it("should return true for __proto__", () => {
      expect(isDangerousProperty("__proto__")).toBe(true);
    });

    it("should return true for constructor", () => {
      expect(isDangerousProperty("constructor")).toBe(true);
    });

    it("should return true for prototype", () => {
      expect(isDangerousProperty("prototype")).toBe(true);
    });

    it("should return false for normal properties", () => {
      expect(isDangerousProperty("name")).toBe(false);
      expect(isDangerousProperty("value")).toBe(false);
      expect(isDangerousProperty("toString")).toBe(false);
    });
  });

  describe("hasOwnProperty", () => {
    it("should return true for own properties", () => {
      expect(hasOwnProperty({ a: 1 }, "a")).toBe(true);
    });

    it("should return false for inherited properties", () => {
      expect(hasOwnProperty({}, "toString")).toBe(false);
    });
  });

  describe("isPlainObject", () => {
    it("should return true for plain objects", () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ a: 1 })).toBe(true);
    });

    it("should return false for arrays", () => {
      expect(isPlainObject([])).toBe(false);
    });

    it("should return false for null", () => {
      expect(isPlainObject(null)).toBe(false);
    });

    it("should return false for primitives", () => {
      expect(isPlainObject("string")).toBe(false);
      expect(isPlainObject(123)).toBe(false);
      expect(isPlainObject(undefined)).toBe(false);
    });
  });

  describe("safePick", () => {
    it("should pick only allowed keys from an object", () => {
      const source = { a: 1, b: 2, c: 3 };
      const result = safePick(source, ["a", "c"]);

      expect(result).toEqual({ a: 1, c: 3 });
    });

    it("should return empty object for non-plain objects", () => {
      expect(safePick(null, ["a"])).toEqual({});
      expect(safePick(undefined, ["a"])).toEqual({});
      expect(safePick("string", ["a"])).toEqual({});
      expect(safePick(123, ["a"])).toEqual({});
    });

    it("should ignore keys that do not exist on source", () => {
      const source = { a: 1 };
      const result = safePick(source, ["a", "b", "c"]);

      expect(result).toEqual({ a: 1 });
    });

    it("should filter out dangerous properties", () => {
      const source = { a: 1, __proto__: {}, constructor: "bad" };
      const result = safePick(source, ["a", "__proto__", "constructor"]);

      expect(result).toEqual({ a: 1 });
      expect(result).not.toHaveProperty("__proto__");
      expect(result).not.toHaveProperty("constructor");
    });

    it("should not copy inherited properties", () => {
      const parent = { inherited: "value" };
      const child = Object.create(parent);
      child.own = "property";
      const result = safePick(child, ["own", "inherited"]);

      expect(result).toEqual({ own: "property" });
      expect(result).not.toHaveProperty("inherited");
    });

    it("should apply custom validator when provided", () => {
      const source = { a: 1, b: "string", c: 2 };
      const result = safePick(source, ["a", "b", "c"], (_key, value) => typeof value === "number");

      expect(result).toEqual({ a: 1, c: 2 });
    });

    it("should prevent prototype pollution via __proto__ in allowed keys", () => {
      const malicious = { __proto__: { polluted: true } };
      const result = safePick(malicious, ["__proto__"]);

      expect(result).toEqual({});
      expect(result["polluted"]).toBeUndefined();
    });
  });
});
