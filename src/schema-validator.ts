import type { JsonSchema, ValidationResult, ValidationError, SchemaVersion } from "./types";
import {
  getOwnPropertyNames,
  hasOwnProperty,
  isDangerousProperty,
  isUnsafeRegexPattern,
  MAX_REGEX_TEST_STRING_LENGTH,
} from "./utils";

// Re-export security utilities for consumers who import from schema-validator
export { isDangerousProperty, isUnsafeRegexPattern } from "./utils";

/**
 * Validate a schema definition for dangerous properties and unsafe patterns.
 * Shared by both SchemaRegistry and the standalone registerSchema function.
 *
 * @param schemaVersion - Schema identifier (for error messages)
 * @param schema - JSON Schema definition to validate
 *
 * @throws If schema contains dangerous property names or unsafe regex patterns
 */
function validateSchemaDefinition(schemaVersion: SchemaVersion, schema: JsonSchema): void {
  if (!schemaVersion || typeof schemaVersion !== "string") {
    throw new Error("Schema version must be a non-empty string.");
  }

  if (schema && typeof schema !== "object") {
    throw new Error("Schema must be an object.");
  }

  if (schema?.properties) {
    const propNames = getOwnPropertyNames(schema.properties);

    for (const key of propNames) {
      if (isDangerousProperty(key)) {
        throw new Error(
          `Schema "${schemaVersion}" defines dangerous property "${key}". ` +
            `Properties like __proto__, constructor, and prototype are not allowed.`
        );
      }

      const propSchema = schema.properties[key];

      if (propSchema?.pattern) {
        const patternCheck = isUnsafeRegexPattern(propSchema.pattern);

        if (patternCheck.unsafe) {
          throw new Error(
            `Schema "${schemaVersion}" contains unsafe regex pattern in property "${key}": ${patternCheck.reason}`
          );
        }
      }
    }
  }

  if (schema?.pattern) {
    const patternCheck = isUnsafeRegexPattern(schema.pattern);

    if (patternCheck.unsafe) {
      throw new Error(
        `Schema "${schemaVersion}" contains unsafe regex pattern: ${patternCheck.reason}`
      );
    }
  }
}

/**
 * Per-instance schema registry.
 *
 * Encapsulates schema storage so each PubSubBus instance maintains
 * its own isolated set of schemas. This prevents cross-contamination
 * when multiple bus instances coexist (e.g., different microfrontends).
 */
export class SchemaRegistry {
  private readonly schemas = new Map<SchemaVersion, JsonSchema>();

  /**
   * Register a schema for validation.
   *
   * @param schemaVersion - Schema identifier with version (e.g., "cart.item.add@1")
   * @param schema - JSON Schema definition
   *
   * @throws If schema contains dangerous property names or unsafe regex patterns
   */
  register(schemaVersion: SchemaVersion, schema: JsonSchema): void {
    validateSchemaDefinition(schemaVersion, schema);
    this.schemas.set(schemaVersion, schema);
  }

  /**
   * Get a registered schema.
   *
   * @param schemaVersion - Schema identifier
   *
   * @returns Schema if registered, undefined otherwise
   */
  get(schemaVersion: SchemaVersion): JsonSchema | undefined {
    return this.schemas.get(schemaVersion);
  }

  /**
   * Check if a schema is registered.
   */
  has(schemaVersion: SchemaVersion): boolean {
    return this.schemas.has(schemaVersion);
  }

  /**
   * Unregister a schema.
   */
  unregister(schemaVersion: SchemaVersion): boolean {
    return this.schemas.delete(schemaVersion);
  }

  /**
   * Clear all registered schemas.
   */
  clear(): void {
    this.schemas.clear();
  }

  /**
   * Validate a payload against a registered schema version.
   *
   * @param payload - Data to validate
   * @param schemaVersion - Registered schema identifier
   *
   * @returns Validation result with errors if any
   */
  validateAgainstVersion(payload: unknown, schemaVersion: SchemaVersion): ValidationResult {
    const schema = this.get(schemaVersion);

    if (!schema) {
      return {
        valid: false,
        errors: [
          {
            path: "",
            message: `Schema "${schemaVersion}" is not registered`,
            expected: "registered schema",
          },
        ],
      };
    }

    return validatePayload(payload, schema);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone (global) functions — backward-compatible API for advanced usage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default global schema registry for standalone usage.
 * The PubSubBus uses its own per-instance registry instead.
 */
const globalRegistry = new SchemaRegistry();

/**
 * Register a schema in the global registry.
 *
 * @param schemaVersion - Schema identifier with version (e.g., "cart.item.add@1")
 * @param schema - JSON Schema definition
 *
 * @throws If schema contains dangerous property names
 */
export function registerSchema(schemaVersion: SchemaVersion, schema: JsonSchema): void {
  globalRegistry.register(schemaVersion, schema);
}

/**
 * Get a registered schema from the global registry.
 *
 * @param schemaVersion - Schema identifier
 *
 * @returns Schema if registered, undefined otherwise
 */
export function getSchema(schemaVersion: SchemaVersion): JsonSchema | undefined {
  return globalRegistry.get(schemaVersion);
}

/**
 * Check if a schema is registered in the global registry.
 */
export function hasSchema(schemaVersion: SchemaVersion): boolean {
  return globalRegistry.has(schemaVersion);
}

/**
 * Unregister a schema from the global registry.
 */
export function unregisterSchema(schemaVersion: SchemaVersion): boolean {
  return globalRegistry.unregister(schemaVersion);
}

/**
 * Clear all schemas in the global registry.
 */
export function clearSchemas(): void {
  globalRegistry.clear();
}

/**
 * Validate a payload against a schema.
 *
 * @param payload - Data to validate
 * @param schema - JSON Schema to validate against
 * @param path - Current path in the object (for error reporting)
 *
 * @returns Validation result with errors if any
 */
export function validatePayload(
  payload: unknown,
  schema: JsonSchema,
  path: string = ""
): ValidationResult {
  const errors: ValidationError[] = [];

  validateValue(payload, schema, path, errors);

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Validate a payload against a registered schema version.
 *
 * @param payload - Data to validate
 * @param schemaVersion - Registered schema identifier
 *
 * @returns Validation result with errors if any
 *
 * @throws If schema is not registered
 */
export function validateAgainstVersion(
  payload: unknown,
  schemaVersion: SchemaVersion
): ValidationResult {
  const schema = getSchema(schemaVersion);

  if (!schema) {
    return {
      valid: false,
      errors: [
        {
          path: "",
          message: `Schema "${schemaVersion}" is not registered`,
          expected: "registered schema",
        },
      ],
    };
  }

  return validatePayload(payload, schema);
}

function validateValue(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: ValidationError[]
): void {
  if (schema.type !== undefined) {
    const actualType = getJsonType(value);

    if (actualType !== schema.type) {
      errors.push({
        path: path || "(root)",
        message: `Expected type "${schema.type}", got "${actualType}"`,
        expected: schema.type,
        actual: actualType,
      });
      return;
    }
  }

  if (schema.enum !== undefined) {
    if (!schema.enum.includes(value)) {
      errors.push({
        path: path || "(root)",
        message: `Value must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`,
        expected: `one of [${schema.enum.join(", ")}]`,
        actual: value,
      });
    }
  }

  const type = schema.type ?? getJsonType(value);

  switch (type) {
    case "object":
      validateObject(value as Record<string, unknown>, schema, path, errors);
      break;
    case "array":
      validateArray(value as unknown[], schema, path, errors);
      break;
    case "string":
      validateString(value as string, schema, path, errors);
      break;
    case "number":
      validateNumber(value as number, schema, path, errors);
      break;
  }
}

function validateObject(
  target: Record<string, unknown>,
  schema: JsonSchema,
  path: string,
  errors: ValidationError[]
): void {
  const targetKeys = getOwnPropertyNames(target);
  for (const key of targetKeys) {
    if (isDangerousProperty(key)) {
      errors.push({
        path: joinPath(path, key),
        message: `Property "${key}" is not allowed (security restriction)`,
        expected: "safe property name",
        actual: key,
      });
    }
  }

  if (schema.required) {
    for (const key of schema.required) {
      if (!hasOwnProperty(target, key)) {
        errors.push({
          path: joinPath(path, key),
          message: `Required property "${key}" is missing`,
          expected: "present",
        });
      }
    }
  }

  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (hasOwnProperty(target, key)) {
        validateValue(target[key], propSchema, joinPath(path, key), errors);
      }
    }
  }

  if (schema.additionalProperties === false && schema.properties) {
    const allowedKeys = new Set(getOwnPropertyNames(schema.properties));
    for (const key of targetKeys) {
      if (!allowedKeys.has(key)) {
        errors.push({
          path: joinPath(path, key),
          message: `Additional property "${key}" is not allowed`,
          expected: "no additional properties",
          actual: key,
        });
      }
    }
  }
}

function validateArray(
  arr: unknown[],
  schema: JsonSchema,
  path: string,
  errors: ValidationError[]
): void {
  if (schema.items) {
    for (let i = 0; i < arr.length; i++) {
      validateValue(arr[i], schema.items, `${path}[${i}]`, errors);
    }
  }
}

function validateString(
  str: string,
  schema: JsonSchema,
  path: string,
  errors: ValidationError[]
): void {
  if (schema.minLength !== undefined && str.length < schema.minLength) {
    errors.push({
      path: path || "(root)",
      message: `String length must be at least ${schema.minLength}`,
      expected: `>= ${schema.minLength} characters`,
      actual: str.length,
    });
  }

  if (schema.maxLength !== undefined && str.length > schema.maxLength) {
    errors.push({
      path: path || "(root)",
      message: `String length must be at most ${schema.maxLength}`,
      expected: `<= ${schema.maxLength} characters`,
      actual: str.length,
    });
  }

  if (schema.pattern !== undefined) {
    const patternCheck = isUnsafeRegexPattern(schema.pattern);
    if (patternCheck.unsafe) {
      errors.push({
        path: path || "(root)",
        message: `Unsafe regex pattern: ${patternCheck.reason}`,
        expected: "safe regex pattern",
        actual: schema.pattern,
      });
      return;
    }

    if (str.length > MAX_REGEX_TEST_STRING_LENGTH) {
      errors.push({
        path: path || "(root)",
        message: `String too long for pattern matching (max ${MAX_REGEX_TEST_STRING_LENGTH} characters)`,
        expected: `<= ${MAX_REGEX_TEST_STRING_LENGTH} characters for regex`,
        actual: str.length,
      });
      return;
    }

    try {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(str)) {
        errors.push({
          path: path || "(root)",
          message: `String must match pattern: ${schema.pattern}`,
          expected: `matches /${schema.pattern}/`,
          actual: str,
        });
      }
    } catch (e) {
      errors.push({
        path: path || "(root)",
        message: `Invalid regex pattern: ${(e as Error).message}`,
        expected: "valid regex pattern",
        actual: schema.pattern,
      });
    }
  }
}

function validateNumber(
  num: number,
  schema: JsonSchema,
  path: string,
  errors: ValidationError[]
): void {
  if (schema.minimum !== undefined && num < schema.minimum) {
    errors.push({
      path: path || "(root)",
      message: `Number must be at least ${schema.minimum}`,
      expected: `>= ${schema.minimum}`,
      actual: num,
    });
  }

  if (schema.maximum !== undefined && num > schema.maximum) {
    errors.push({
      path: path || "(root)",
      message: `Number must be at most ${schema.maximum}`,
      expected: `<= ${schema.maximum}`,
      actual: num,
    });
  }
}

function getJsonType(value: unknown): JsonSchema["type"] {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }

  const type = typeof value;

  if (type === "object") {
    return "object";
  }
  if (type === "string") {
    return "string";
  }
  if (type === "number") {
    return "number";
  }
  if (type === "boolean") {
    return "boolean";
  }

  return undefined;
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}
