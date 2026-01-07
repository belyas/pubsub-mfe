import type { TopicPattern, Topic, CompiledMatcher, MatcherSegment } from "./types";

const SEGMENT_DELIMITER = ".";
const SINGLE_WILDCARD = "+";
const MULTI_WILDCARD = "#";
// Cache for compiled matchers to avoid recompilation
const matcherCache = new Map<TopicPattern, CompiledMatcher>();

/**
 * Compile a topic pattern into a matcher for efficient repeated matching.
 *
 * @param pattern - Topic pattern (e.g. "cart.+.update", "cart.#")
 *
 * @returns Compiled matcher object
 * @throws If pattern is invalid (e.g. # not at end, empty segments)
 */
export function compileMatcher(pattern: TopicPattern): CompiledMatcher {
  const cached = matcherCache.get(pattern);

  if (cached) {
    return cached;
  }

  if (!pattern || typeof pattern !== "string") {
    throw new Error(`Invalid topic pattern: ${pattern}.`);
  }

  const segments = splitTopic(pattern);
  const matcherSegments: MatcherSegment[] = [];
  let hasWildcards = false;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // Empty segment check (e.g., "cart..item" or ".cart")
    if (segment === "") {
      throw new Error(`Invalid topic pattern "${pattern}": empty segment at position ${i}.`);
    }

    if (segment === MULTI_WILDCARD) {
      // # must be the last segment
      if (i !== segments.length - 1) {
        throw new Error(`Invalid topic pattern "${pattern}": # wildcard must be at the end.`);
      }

      hasWildcards = true;
      matcherSegments.push({ type: "multi" });
    } else if (segment === SINGLE_WILDCARD) {
      hasWildcards = true;
      matcherSegments.push({ type: "single" });
    } else {
      // Literal segment — validate characters (alphanumeric, hyphen, underscore)
      if (!/^[a-zA-Z0-9_-]+$/.test(segment)) {
        throw new Error(
          `Invalid topic pattern "${pattern}": segment "${segment}" contains invalid characters. Use alphanumeric, hyphen, or underscore only.`
        );
      }

      matcherSegments.push({ type: "literal", value: segment });
    }
  }

  const matcher: CompiledMatcher = {
    pattern,
    hasWildcards,
    segments: matcherSegments,
  };

  matcherCache.set(pattern, matcher);

  return matcher;
}

/**
 * Test if a topic matches a compiled pattern using segment-by-segment comparison.
 * Uses a Trie-like algorithm without regex overhead.
 *
 * @param topic - Topic to match
 * @param matcher - Compiled matcher from compileMatcher()
 *
 * @returns true if topic matches the pattern
 */
export function matchTopic(topic: Topic, matcher: CompiledMatcher): boolean {
  if (!matcher.hasWildcards) {
    return topic === matcher.pattern;
  }

  // Trie-based segment matching for wildcard patterns
  const topicSegments = splitTopic(topic);
  const patternSegments = matcher.segments;

  return matchSegments(topicSegments, 0, patternSegments, 0);
}

/**
 * Recursive segment-by-segment matching.
 * Handles +, #, and literal segments.
 */
function matchSegments(
  topicSegments: string[],
  topicIndex: number,
  patternSegments: MatcherSegment[],
  patternIndex: number
): boolean {
  if (patternIndex >= patternSegments.length) {
    return topicIndex >= topicSegments.length;
  }

  const patternSegment = patternSegments[patternIndex];

  switch (patternSegment.type) {
    case "multi":
      // # matches zero or more remaining segments
      // Since # must be last, we're done
      return true;

    case "single":
      // + matches exactly one segment
      if (topicIndex >= topicSegments.length) {
        return false;
      }
      return matchSegments(topicSegments, topicIndex + 1, patternSegments, patternIndex + 1);

    case "literal":
      // Literal must match exactly
      if (topicIndex >= topicSegments.length) {
        return false;
      }
      if (topicSegments[topicIndex] !== patternSegment.value) {
        return false;
      }
      return matchSegments(topicSegments, topicIndex + 1, patternSegments, patternIndex + 1);
  }
}

/**
 * Validate a publish topic (exact topic, no wildcards).
 *
 * @param topic - Topic to validate
 *
 * @throws If topic contains wildcards or invalid characters
 */
export function validatePublishTopic(topic: Topic): void {
  if (!topic || typeof topic !== "string") {
    throw new Error(`Invalid topic: ${topic}`);
  }

  if (topic.includes(SINGLE_WILDCARD) || topic.includes(MULTI_WILDCARD)) {
    throw new Error(
      `Invalid publish topic "${topic}": wildcards (+ or #) are not allowed in publish topics. Use exact topic names for publishing.`
    );
  }

  const segments = splitTopic(topic);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    if (segment === "") {
      throw new Error(`Invalid topic "${topic}": empty segment at position ${i}`);
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(segment)) {
      throw new Error(
        `Invalid topic "${topic}": segment "${segment}" contains invalid characters. Use alphanumeric, hyphen, or underscore only.`
      );
    }
  }
}

/**
 * Split a topic into segments.
 */
export function splitTopic(topic: Topic): string[] {
  return topic.split(SEGMENT_DELIMITER);
}

/**
 * Join segments into a topic.
 */
export function joinTopic(...segments: string[]): Topic {
  return segments.join(SEGMENT_DELIMITER);
}

/**
 * Clear the matcher cache.
 * Useful for testing or when patterns change.
 */
export function clearMatcherCache(): void {
  matcherCache.clear();
}

/**
 * Get the size of the matcher cache.
 * Useful for diagnostics.
 */
export function getMatcherCacheSize(): number {
  return matcherCache.size;
}
