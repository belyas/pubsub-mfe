import { describe, it, expect, beforeEach } from "vitest";
import {
  SchemaRegistry,
  registerSchema,
  getSchema,
  hasSchema,
  unregisterSchema,
  clearSchemas,
  validatePayload,
  validateAgainstVersion,
} from "./schema-validator";

describe("schema-validator", () => {
  beforeEach(() => {
    clearSchemas();
  });

  describe("Registration", () => {
    it("should register and retrieves a schema", () => {
      const schema = { type: "object" as const };

      registerSchema("test@1", schema);
      expect(getSchema("test@1")).toBe(schema);
    });

    it("should check if schema exists", () => {
      expect(hasSchema("test@1")).toBe(false);
      registerSchema("test@1", { type: "object" });
      expect(hasSchema("test@1")).toBe(true);
    });

    it("should unregister a schema", () => {
      registerSchema("test@1", { type: "object" });
      expect(unregisterSchema("test@1")).toBe(true);
      expect(hasSchema("test@1")).toBe(false);
    });

    it("should clear all schemas", () => {
      registerSchema("test@1", { type: "object" });
      registerSchema("test@2", { type: "object" });
      clearSchemas();
      expect(hasSchema("test@1")).toBe(false);
      expect(hasSchema("test@2")).toBe(false);
    });

    it("should throw on invalid schema version", () => {
      expect(() => registerSchema("", { type: "object" })).toThrow();
      expect(() => registerSchema(null as unknown as string, {})).toThrow();
    });
  });

  describe("Type validation", () => {
    it("should validate object type", () => {
      expect(validatePayload({}, { type: "object" }).valid).toBe(true);
      expect(validatePayload([], { type: "object" }).valid).toBe(false);
      expect(validatePayload("string", { type: "object" }).valid).toBe(false);
    });

    it("should validate array type", () => {
      expect(validatePayload([], { type: "array" }).valid).toBe(true);
      expect(validatePayload([1, 2, 3], { type: "array" }).valid).toBe(true);
      expect(validatePayload({}, { type: "array" }).valid).toBe(false);
    });

    it("should validate string type", () => {
      expect(validatePayload("hello", { type: "string" }).valid).toBe(true);
      expect(validatePayload("", { type: "string" }).valid).toBe(true);
      expect(validatePayload(123, { type: "string" }).valid).toBe(false);
    });

    it("should validate number type", () => {
      expect(validatePayload(123, { type: "number" }).valid).toBe(true);
      expect(validatePayload(0, { type: "number" }).valid).toBe(true);
      expect(validatePayload(3.14, { type: "number" }).valid).toBe(true);
      expect(validatePayload("123", { type: "number" }).valid).toBe(false);
    });

    it("should validate boolean type", () => {
      expect(validatePayload(true, { type: "boolean" }).valid).toBe(true);
      expect(validatePayload(false, { type: "boolean" }).valid).toBe(true);
      expect(validatePayload(1, { type: "boolean" }).valid).toBe(false);
    });

    it("should validate null type", () => {
      expect(validatePayload(null, { type: "null" }).valid).toBe(true);
      expect(validatePayload(undefined, { type: "null" }).valid).toBe(false);
      expect(validatePayload({}, { type: "null" }).valid).toBe(false);
    });
  });

  describe("Object validation", () => {
    it("should validate required properties", () => {
      const schema = {
        type: "object" as const,
        required: ["name", "age"],
      };

      expect(validatePayload({ name: "John", age: 30 }, schema).valid).toBe(true);
      expect(validatePayload({ name: "John" }, schema).valid).toBe(false);
      expect(validatePayload({}, schema).valid).toBe(false);
    });

    it("should validate property types", () => {
      const schema = {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
          age: { type: "number" as const },
        },
      };

      expect(validatePayload({ name: "John", age: 30 }, schema).valid).toBe(true);
      expect(validatePayload({ name: "John", age: "30" }, schema).valid).toBe(false);
    });

    it("should validate additionalProperties", () => {
      const schema = {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
        },
        additionalProperties: false,
      };

      expect(validatePayload({ name: "John" }, schema).valid).toBe(true);
      expect(validatePayload({ name: "John", extra: "field" }, schema).valid).toBe(false);
    });

    it("should allow extra properties when additionalProperties is not false", () => {
      const schema = {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
        },
      };

      expect(validatePayload({ name: "John", extra: "field" }, schema).valid).toBe(true);
    });
  });

  describe("Array validation", () => {
    it("should validate item types", () => {
      const schema = {
        type: "array" as const,
        items: { type: "number" as const },
      };

      expect(validatePayload([1, 2, 3], schema).valid).toBe(true);
      expect(validatePayload([], schema).valid).toBe(true);
      expect(validatePayload([1, "two", 3], schema).valid).toBe(false);
    });

    it("should validate nested objects in arrays", () => {
      const schema = {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            id: { type: "number" as const },
          },
          required: ["id"],
        },
      };

      expect(validatePayload([{ id: 1 }, { id: 2 }], schema).valid).toBe(true);
      expect(validatePayload([{ id: 1 }, { name: "John" }], schema).valid).toBe(false);
    });
  });

  describe("String constraints", () => {
    it("should validate minLength", () => {
      const schema = { type: "string" as const, minLength: 3 };

      expect(validatePayload("abc", schema).valid).toBe(true);
      expect(validatePayload("ab", schema).valid).toBe(false);
    });

    it("should validate maxLength", () => {
      const schema = { type: "string" as const, maxLength: 5 };

      expect(validatePayload("hello", schema).valid).toBe(true);
      expect(validatePayload("hello!", schema).valid).toBe(false);
    });

    it("should validate pattern", () => {
      const schema = { type: "string" as const, pattern: "^[A-Z]{3}[0-9]{3}$" };

      expect(validatePayload("ABC123", schema).valid).toBe(true);
      expect(validatePayload("abc123", schema).valid).toBe(false);
      expect(validatePayload("ABCD123", schema).valid).toBe(false);
    });
  });

  describe("Number constraints", () => {
    it("should validate minimum", () => {
      const schema = { type: "number" as const, minimum: 0 };

      expect(validatePayload(0, schema).valid).toBe(true);
      expect(validatePayload(10, schema).valid).toBe(true);
      expect(validatePayload(-1, schema).valid).toBe(false);
    });

    it("should validate maximum", () => {
      const schema = { type: "number" as const, maximum: 100 };

      expect(validatePayload(100, schema).valid).toBe(true);
      expect(validatePayload(50, schema).valid).toBe(true);
      expect(validatePayload(101, schema).valid).toBe(false);
    });
  });

  describe("Enum validation", () => {
    it("should validate enum values", () => {
      const schema = { enum: ["small", "medium", "large"] };

      expect(validatePayload("small", schema).valid).toBe(true);
      expect(validatePayload("medium", schema).valid).toBe(true);
      expect(validatePayload("xlarge", schema).valid).toBe(false);
    });
  });

  describe("ValidateAgainstVersion", () => {
    it("should validate against registered schema", () => {
      registerSchema("cart.item@1", {
        type: "object",
        properties: {
          sku: { type: "string" },
          qty: { type: "number", minimum: 1 },
        },
        required: ["sku", "qty"],
        additionalProperties: false,
      });

      expect(validateAgainstVersion({ sku: "ABC123", qty: 2 }, "cart.item@1").valid).toBe(true);
      expect(validateAgainstVersion({ sku: "ABC123", qty: 0 }, "cart.item@1").valid).toBe(false);
      expect(validateAgainstVersion({ sku: "ABC123" }, "cart.item@1").valid).toBe(false);
    });

    it("should return error for unregistered schema", () => {
      const result = validateAgainstVersion({}, "unknown@1");

      expect(result.valid).toBe(false);
      expect(result.errors?.[0].message).toContain('Schema "unknown@1" is not registered');
    });
  });

  describe("Error messages", () => {
    it("should provide path information for nested errors", () => {
      const schema = {
        type: "object" as const,
        properties: {
          user: {
            type: "object" as const,
            properties: {
              email: { type: "string" as const },
            },
            required: ["email"],
          },
        },
      };
      const result = validatePayload({ user: {} }, schema);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0].path).toBe("user.email");
      expect(result.errors?.[0].message).toContain('Required property "email" is missing');
    });

    it("should provide array index in path for array errors", () => {
      const schema = {
        type: "array" as const,
        items: { type: "number" as const },
      };

      const result = validatePayload([1, "two", 3], schema);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0].path).toBe("[1]");
    });
  });

  describe("Prototype pollution prevention", () => {
    it("should reject __proto__ property in payload", () => {
      const schema = { type: "object" as const };
      // Using Object.create(null) and assigning to avoid TS error
      const payload = Object.create(null);
      payload["__proto__"] = { admin: true };
      payload.name = "test";
      const result = validatePayload(payload, schema);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0].message).toContain("__proto__");
      expect(result.errors?.[0].message).toContain("security restriction");
    });

    it("should reject constructor property in payload", () => {
      const schema = { type: "object" as const };
      const payload = Object.create(null);
      payload["constructor"] = function () {
        return {};
      };
      const result = validatePayload(payload, schema);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0].message).toContain("constructor");
    });

    it("should reject prototype property in payload", () => {
      const schema = { type: "object" as const };
      const payload = Object.create(null);
      payload["prototype"] = { malicious: true };
      const result = validatePayload(payload, schema);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0].message).toContain("prototype");
    });

    it("should reject schema with __proto__ in properties", () => {
      // Create properties object with __proto__ as an actual own property
      const properties = Object.create(null);

      Object.defineProperty(properties, "__proto__", {
        value: { type: "object" as const },
        enumerable: true,
        configurable: true,
        writable: true,
      });

      const schema = {
        type: "object" as const,
        properties,
      };

      expect(() => registerSchema("malicious@1", schema)).toThrow('dangerous property "__proto__"');
    });

    it("should reject schema with constructor in properties", () => {
      const schema = {
        type: "object" as const,
        properties: {
          constructor: { type: "object" as const },
        },
      };

      expect(() => registerSchema("malicious@2", schema)).toThrow(
        'dangerous property "constructor"'
      );
    });

    it('should use Object.hasOwn() not "in" operator for required check', () => {
      // This test ensures we don't get false positives from inherited properties
      const schema = {
        type: "object" as const,
        required: ["toString"], // Inherited from Object.prototype
      };
      const payload = { name: "test" }; // Has inherited toString but not own property
      const result = validatePayload(payload, schema);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0].message).toContain('Required property "toString" is missing');
    });

    it("should validate nested objects for dangerous properties", () => {
      const schema = {
        type: "object" as const,
        properties: {
          nested: { type: "object" as const },
        },
      };
      // Create nested object with __proto__ as an actual own property
      const nested = Object.create(null);
      Object.defineProperty(nested, "__proto__", {
        value: { malicious: true },
        enumerable: true,
        configurable: true,
        writable: true,
      });
      const payload = { nested };
      const result = validatePayload(payload, schema);

      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("__proto__"))).toBe(true);
    });
  });

  describe("ReDoS prevention", () => {
    it("should reject nested quantifiers pattern (a+)+", () => {
      const schema = {
        type: "string" as const,
        pattern: "(a+)+",
      };

      expect(() => registerSchema("evil-regex@1", schema)).toThrow("nested quantifiers");
    });

    it("should reject nested quantifiers pattern (.*)+", () => {
      const schema = {
        type: "string" as const,
        pattern: "(.*)+",
      };

      expect(() => registerSchema("evil-regex@2", schema)).toThrow("nested quantifiers");
    });

    it("should reject overlapping alternation pattern (a|aa)+", () => {
      const schema = {
        type: "string" as const,
        pattern: "(a|aa)+",
      };

      expect(() => registerSchema("evil-regex@3", schema)).toThrow("overlapping alternations");
    });

    it("should reject character class with quantifier in group ([a-z]+)+", () => {
      const schema = {
        type: "string" as const,
        pattern: "([a-z]+)+",
      };

      expect(() => registerSchema("evil-regex@4", schema)).toThrow(
        /nested quantifiers|character class/
      );
    });

    it("should reject patterns exceeding max length", () => {
      const schema = {
        type: "string" as const,
        pattern: "a".repeat(300), // Exceeds 256 char limit
      };

      expect(() => registerSchema("long-regex@1", schema)).toThrow("exceeds maximum length");
    });

    it("should reject evil pattern in property schema", () => {
      const schema = {
        type: "object" as const,
        properties: {
          email: {
            type: "string" as const,
            pattern: "(a+)+@example.com",
          },
        },
      };

      expect(() => registerSchema("evil-prop@1", schema)).toThrow("nested quantifiers");
    });

    it("should allow safe regex patterns", () => {
      const schema = {
        type: "string" as const,
        pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
      };

      registerSchema("safe-email@1", schema);
      expect(hasSchema("safe-email@1")).toBe(true);
    });

    it("should allow simple quantifiers without nesting", () => {
      const schema = {
        type: "string" as const,
        pattern: "^[a-z]+$",
      };

      registerSchema("simple@1", schema);
      expect(hasSchema("simple@1")).toBe(true);
    });

    it("should validate string against safe pattern", () => {
      registerSchema("alphanumeric@1", {
        type: "string" as const,
        pattern: "^[a-zA-Z0-9]+$",
      });

      const validResult = validateAgainstVersion("Hello123", "alphanumeric@1");
      expect(validResult.valid).toBe(true);

      const invalidResult = validateAgainstVersion("Hello 123!", "alphanumeric@1");
      expect(invalidResult.valid).toBe(false);
    });

    it("should reject very long strings for pattern matching", () => {
      registerSchema("short-pattern@1", {
        type: "string" as const,
        pattern: "^test$",
      });

      const longString = "a".repeat(15000);
      const result = validateAgainstVersion(longString, "short-pattern@1");

      expect(result.valid).toBe(false);
      expect(result.errors?.[0].message).toContain("too long for pattern matching");
    });

    it("should report invalid regex syntax as error", () => {
      // This pattern is syntactically invalid
      const schema = {
        type: "string" as const,
        pattern: "[unclosed",
      };

      // Registration might pass (syntax check happens at test time for some engines)
      // But validation should handle the error gracefully
      const result = validatePayload("test", schema);

      // Either it's caught at registration or at validation
      // The key is it doesn't throw uncaught
      expect(result.valid).toBe(false);
    });
  });
});

describe("SchemaRegistry (per-instance)", () => {
  it("should register and retrieve schemas independently", () => {
    const registryA = new SchemaRegistry();
    const registryB = new SchemaRegistry();

    registryA.register("item@1", { type: "object" });

    expect(registryA.has("item@1")).toBe(true);
    expect(registryB.has("item@1")).toBe(false);
  });

  it("should not leak schemas between instances", () => {
    const registryA = new SchemaRegistry();
    const registryB = new SchemaRegistry();

    registryA.register("a@1", { type: "string" });
    registryB.register("b@1", { type: "number" });

    expect(registryA.has("a@1")).toBe(true);
    expect(registryA.has("b@1")).toBe(false);
    expect(registryB.has("b@1")).toBe(true);
    expect(registryB.has("a@1")).toBe(false);
  });

  it("should get a registered schema", () => {
    const registry = new SchemaRegistry();
    const schema = { type: "object" as const };

    registry.register("test@1", schema);
    expect(registry.get("test@1")).toBe(schema);
  });

  it("should return undefined for unregistered schema", () => {
    const registry = new SchemaRegistry();

    expect(registry.get("missing@1")).toBeUndefined();
  });

  it("should unregister a schema", () => {
    const registry = new SchemaRegistry();

    registry.register("test@1", { type: "object" });
    expect(registry.unregister("test@1")).toBe(true);
    expect(registry.has("test@1")).toBe(false);
  });

  it("should return false when unregistering a non-existent schema", () => {
    const registry = new SchemaRegistry();

    expect(registry.unregister("missing@1")).toBe(false);
  });

  it("should clear all schemas in one instance without affecting another", () => {
    const registryA = new SchemaRegistry();
    const registryB = new SchemaRegistry();

    registryA.register("a@1", { type: "string" });
    registryB.register("b@1", { type: "number" });

    registryA.clear();

    expect(registryA.has("a@1")).toBe(false);
    expect(registryB.has("b@1")).toBe(true);
  });

  it("should validate against a registered versioned schema", () => {
    const registry = new SchemaRegistry();

    registry.register("item@1", {
      type: "object",
      properties: {
        sku: { type: "string" },
        qty: { type: "number", minimum: 1 },
      },
      required: ["sku", "qty"],
    });

    const validResult = registry.validateAgainstVersion({ sku: "ABC", qty: 2 }, "item@1");
    expect(validResult.valid).toBe(true);

    const invalidResult = registry.validateAgainstVersion({ sku: "ABC", qty: 0 }, "item@1");
    expect(invalidResult.valid).toBe(false);
  });

  it("should return error when validating against unregistered schema", () => {
    const registry = new SchemaRegistry();
    const result = registry.validateAgainstVersion({}, "missing@1");

    expect(result.valid).toBe(false);
    expect(result.errors?.[0].message).toContain('Schema "missing@1" is not registered');
  });

  it("should reject ReDoS patterns during registration", () => {
    const registry = new SchemaRegistry();

    expect(() => registry.register("evil@1", { type: "string", pattern: "(a+)+" })).toThrow(
      "nested quantifiers"
    );
  });

  it("should reject prototype pollution in schema properties", () => {
    const registry = new SchemaRegistry();

    expect(() =>
      registry.register("bad@1", {
        type: "object" as const,
        properties: {
          constructor: { type: "object" as const },
        },
      })
    ).toThrow('dangerous property "constructor"');
  });
});
