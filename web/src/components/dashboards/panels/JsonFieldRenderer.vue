<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    :class="['json-field-renderer', isValidJSON ? 'font-mono text-xs leading-[1.5]' : '']"
    data-test="json-field-renderer"
  >
    <div v-if="parsedData === null || parsedData === undefined">
      {{ value }}
    </div>
    <div v-else-if="Array.isArray(parsedData)">
      <!-- Array of primitives: ["a", "b", "c"] -> render as lines -->
      <div v-if="isArrayOfPrimitives" class="flex flex-col" data-test="json-array-items">
        <div
          v-for="(item, index) in definedItems"
          :key="index"
          class="py-0.5"
          data-test="json-array-item"
        >
          <span :style="{ color: getValueColor(item) }">{{ formatValue(item) }}</span>
        </div>
      </div>
      <!-- Array of objects: [{"user": "admin"}, ...] -> render each object -->
      <div v-else class="flex flex-col" data-test="json-array-objects">
        <div v-for="(item, index) in definedItems" :key="index" class="py-0.5 break-words">
          <span v-if="typeof item === 'object' && item !== null">
            <span class="text-text-muted">{</span>
            <template v-for="(val, key) in getDefinedEntries(item)" :key="key">
              <span class="inline">
                <span class="font-medium" :style="{ color: keyColor }" data-test="json-key">{{
                  key
                }}</span>
                <span class="text-text-muted">: </span>
                <span
                  class="break-words"
                  :style="{ color: getValueColor(val) }"
                  data-test="json-value"
                  >{{ formatValue(val) }}</span
                >
              </span>
              <span v-if="!isLastDefinedEntry(item, key)" class="text-text-muted">, </span>
            </template>
            <span class="text-text-muted">}</span>
          </span>
          <span v-else :style="{ color: getValueColor(item) }">{{ formatValue(item) }}</span>
        </div>
      </div>
    </div>
    <!-- Single object: {"key": "value"} -> render key-value pairs -->
    <div v-else-if="typeof parsedData === 'object'" class="break-words" data-test="json-object">
      <span class="text-text-muted">{</span>
      <template v-for="(val, key, idx) in definedObjectEntries" :key="key">
        <span class="inline">
          <span class="font-medium" :style="{ color: keyColor }" data-test="json-key">{{
            key
          }}</span>
          <span class="text-text-muted">: </span>
          <span class="break-words" :style="{ color: getValueColor(val) }" data-test="json-value">{{
            formatValue(val)
          }}</span>
        </span>
        <span v-if="idx < definedObjectKeys.length - 1" class="text-text-muted">, </span>
      </template>
      <span class="text-text-muted">}</span>
    </div>
    <!-- Primitive value: only apply JSON coloring if the value was valid JSON -->
    <div v-else>
      <span :style="isValidJSON ? { color: getValueColor(parsedData) } : {}">{{
        formatValue(parsedData)
      }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useTheme } from "@/composables/useTheme";
import { chartColor } from "@/utils/chartTheme";

export interface Props {
  value: any;
}

const props = defineProps<Props>();
const { isDark } = useTheme();

// Parse the value if it's a string, otherwise use as-is
// Also tracks whether JSON parsing succeeded so we don't color plain strings as JSON
const parseResult = computed(() => {
  if (typeof props.value === "string") {
    try {
      const parsed = JSON.parse(props.value);
      // Only treat as JSON if the parsed result is an object or array.
      // Bare primitives ("42", "true", "null") are valid JSON but should
      // not be colored -> they're just plain field values stored as strings.
      const isStructuredJSON = parsed !== null && typeof parsed === "object";
      return { data: parsed, isJSON: isStructuredJSON };
    } catch (e) {
      return { data: props.value, isJSON: false };
    }
  }
  return { data: props.value, isJSON: false };
});

const parsedData = computed(() => parseResult.value.data);

// True when the original string was valid JSON (or value was not a string).
// Used to avoid coloring plain non-JSON strings (e.g. timestamps) like JSON values.
const isValidJSON = computed(() => parseResult.value.isJSON);

// Check if array contains only primitives (strings, numbers, booleans, null)
const isArrayOfPrimitives = computed(() => {
  if (!Array.isArray(parsedData.value)) return false;
  return parsedData.value.every(
    (item) =>
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null ||
      item === undefined,
  );
});

// Filter undefined values from array - memoized
const definedItems = computed(() => {
  if (!Array.isArray(parsedData.value)) return [];
  return parsedData.value.filter((item) => item !== undefined);
});

// Memoized defined entries for single objects
const definedObjectEntries = computed(() => {
  if (
    typeof parsedData.value === "object" &&
    !Array.isArray(parsedData.value) &&
    parsedData.value !== null
  ) {
    return getDefinedEntries(parsedData.value);
  }
  return {};
});

// Memoized keys for single objects
const definedObjectKeys = computed(() => Object.keys(definedObjectEntries.value));

// Get color for JSON keys — resolved from theme-aware design tokens.
// Reading isDark.value keeps this reactive so it recomputes on theme switch
// (chartColor's cache is invalidated on theme change).
const keyColor = computed(() => {
  void isDark.value;
  return chartColor("--color-json-key");
});

// Get color for values based on type — routed through --color-json-* tokens.
const getValueColor = (value: any): string => {
  void isDark.value;
  if (value === null) {
    return chartColor("--color-json-null");
  } else if (typeof value === "boolean") {
    return chartColor("--color-json-boolean");
  } else if (typeof value === "number") {
    return chartColor("--color-json-number");
  } else if (typeof value === "string") {
    return chartColor("--color-json-string");
  }
  return chartColor("--color-json-object");
};

// Format value for display
const formatValue = (value: any): string => {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (value === "undefined") return "";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string") return value;
  return String(value);
};

// Cache for defined entries to avoid recomputation
const definedEntriesCache = new WeakMap<object, { entries: Record<string, any>; keys: string[] }>();

// Get object entries excluding undefined values - optimized with caching
const getDefinedEntries = (obj: any): Record<string, any> => {
  if (!obj || typeof obj !== "object") return {};

  // Check cache first
  if (definedEntriesCache.has(obj)) {
    return definedEntriesCache.get(obj)!.entries;
  }

  const result: Record<string, any> = {};
  const keys: string[] = [];

  Object.entries(obj).forEach(([key, value]) => {
    if (value !== undefined) {
      result[key] = value;
      keys.push(key);
    }
  });

  // Cache the result
  definedEntriesCache.set(obj, { entries: result, keys });
  return result;
};

// Check if current key is the last defined entry - optimized
const isLastDefinedEntry = (obj: any, currentKey: string): boolean => {
  if (!obj || typeof obj !== "object") return true;

  // Use cached keys if available
  const cached = definedEntriesCache.get(obj);
  const keys = cached ? cached.keys : Object.keys(getDefinedEntries(obj));

  return keys.indexOf(currentKey) === keys.length - 1;
};
</script>
