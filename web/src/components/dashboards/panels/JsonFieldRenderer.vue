<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="json-field-renderer">
    <div v-if="parsedData === null || parsedData === undefined">
      {{ value }}
    </div>
    <div v-else-if="Array.isArray(parsedData)">
      <!-- Array of primitives: ["a", "b", "c"] -> render as lines -->
      <div v-if="isArrayOfPrimitives" class="json-array-items">
        <div
          v-for="(item, index) in definedItems"
          :key="index"
          class="json-array-item"
        >
          <span :style="{ color: getValueColor(item) }">{{ formatValue(item) }}</span>
        </div>
      </div>
      <!-- Array of objects: [{"user": "admin"}, ...] -> render each object -->
      <div v-else class="json-array-objects">
        <div
          v-for="(item, index) in definedItems"
          :key="index"
          class="json-object-item"
        >
          <span v-if="typeof item === 'object' && item !== null">
            <span class="json-brace">{</span>
            <template v-for="(val, key) in getDefinedEntries(item)" :key="key">
              <span class="json-key-value">
                <span class="json-key" :style="{ color: keyColor }">{{ key }}</span>
                <span class="json-colon">: </span>
                <span class="json-value" :style="{ color: getValueColor(val) }">{{ formatValue(val) }}</span>
              </span>
              <span v-if="!isLastDefinedEntry(item, key)" class="json-comma">, </span>
            </template>
            <span class="json-brace">}</span>
          </span>
          <span v-else :style="{ color: getValueColor(item) }">{{ formatValue(item) }}</span>
        </div>
      </div>
    </div>
    <!-- Single object: {"key": "value"} -> render key-value pairs -->
    <div v-else-if="typeof parsedData === 'object'" class="json-object">
      <span class="json-brace">{</span>
      <template v-for="(val, key, idx) in definedObjectEntries" :key="key">
        <span class="json-key-value">
          <span class="json-key" :style="{ color: keyColor }">{{ key }}</span>
          <span class="json-colon">: </span>
          <span class="json-value" :style="{ color: getValueColor(val) }">{{ formatValue(val) }}</span>
        </span>
        <span v-if="idx < definedObjectKeys.length - 1" class="json-comma">, </span>
      </template>
      <span class="json-brace">}</span>
    </div>
    <!-- Primitive value -->
    <div v-else>
      <span :style="{ color: getValueColor(parsedData) }">{{ formatValue(parsedData) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";

export interface Props {
  value: any;
}

const props = defineProps<Props>();
const store = useStore();

// Parse the value if it's a string, otherwise use as-is
const parsedData = computed(() => {
  if (typeof props.value === "string") {
    try {
      return JSON.parse(props.value);
    } catch (e) {
      return props.value;
    }
  }
  return props.value;
});

// Check if theme is dark - memoized
const isDarkTheme = computed(() => store.state.theme === "dark");

// Check if array contains only primitives (strings, numbers, booleans, null)
const isArrayOfPrimitives = computed(() => {
  if (!Array.isArray(parsedData.value)) return false;
  return parsedData.value.every(
    (item) =>
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null ||
      item === undefined
  );
});

// Filter undefined values from array - memoized
const definedItems = computed(() => {
  if (!Array.isArray(parsedData.value)) return [];
  return parsedData.value.filter((item) => item !== undefined);
});

// Memoized defined entries for single objects
const definedObjectEntries = computed(() => {
  if (typeof parsedData.value === 'object' && !Array.isArray(parsedData.value) && parsedData.value !== null) {
    return getDefinedEntries(parsedData.value);
  }
  return {};
});

// Memoized keys for single objects
const definedObjectKeys = computed(() => Object.keys(definedObjectEntries.value));

// Get color for JSON keys based on theme
const keyColor = computed(() => {
  return isDarkTheme.value ? "#f67a7aff" : "#B71C1C";
});

// Get color for values based on type and theme
const getValueColor = (value: any): string => {
  const isDark = isDarkTheme.value;

  if (value === null) {
    return isDark ? "#9CA3AF" : "#6B7280";
  } else if (typeof value === "boolean") {
    return isDark ? "#A5B4FC" : "#6D28D9";
  } else if (typeof value === "number") {
    return isDark ? "#60A5FA" : "#2563EB";
  } else if (typeof value === "string") {
    return isDark ? "#6EE7B7" : "#047857";
  } else if (typeof value === "object") {
    return isDark ? "#D1D5DB" : "#4B5563";
  }
  return isDark ? "#D1D5DB" : "#4B5563";
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
  if (!obj || typeof obj !== 'object') return {};

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
  if (!obj || typeof obj !== 'object') return true;

  // Use cached keys if available
  const cached = definedEntriesCache.get(obj);
  const keys = cached ? cached.keys : Object.keys(getDefinedEntries(obj));

  return keys.indexOf(currentKey) === keys.length - 1;
};
</script>

<style lang="scss" scoped>
.json-field-renderer {
  font-family: monospace;
  font-size: 12px;
  line-height: 1.5;
}

.json-array-items {
  display: flex;
  flex-direction: column;
}

.json-array-item {
  padding: 2px 0;
}

.json-array-objects {
  display: flex;
  flex-direction: column;
}

.json-object-item {
  padding: 2px 0;
  word-break: break-word;
}

.json-object {
  word-break: break-word;
}

.json-key-value {
  display: inline;
}

.json-key {
  font-weight: 500;
}

.json-colon {
  color: #9ca3af;
}

.json-comma {
  color: #9ca3af;
}

.json-value {
  word-break: break-word;
}

.json-brace {
  color: #9ca3af;
}
</style>
