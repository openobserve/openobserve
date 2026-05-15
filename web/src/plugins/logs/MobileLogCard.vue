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
    class="mobile-log-card"
    :class="severityClass"
    @click="$emit('click', row, index)"
    @keydown.enter="$emit('click', row, index)"
    @keydown.space.prevent="$emit('click', row, index)"
    role="button"
    tabindex="0"
    :aria-label="`Log entry ${index + 1}`"
  >
    <div class="mobile-log-card__header">
      <span class="mobile-log-card__timestamp">{{ formattedTime }}</span>
      <span v-if="severityLabel" class="mobile-log-card__severity">{{
        severityLabel
      }}</span>
    </div>
    <div class="mobile-log-card__body">{{ truncatedMessage }}</div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, type PropType } from "vue";

export default defineComponent({
  name: "MobileLogCard",
  props: {
    row: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
    index: {
      type: Number,
      required: true,
    },
  },
  emits: ["click"],
  setup(props) {
    const formattedTime = computed(() => {
      if (!props.row) return "";
      const ts =
        props.row._timestamp || props.row["@timestamp"] || props.row.timestamp;
      if (!ts) return "";
      try {
        // Timestamps can arrive as nanoseconds (post-2001 ns is > 10^18),
        // microseconds (post-2001 µs is > 10^15), or milliseconds. Normalize
        // to ms for Date().
        const NS_THRESHOLD = 1e18;
        const US_THRESHOLD = 1e15;
        let msTs = ts;
        if (typeof ts === "number") {
          if (ts > NS_THRESHOLD) msTs = ts / 1e6;
          else if (ts > US_THRESHOLD) msTs = ts / 1000;
        }
        const date = new Date(msTs);
        const now = Date.now();
        const diff = now - date.getTime();
        if (diff < 0)
          return date.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
        if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return date.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        return String(ts).substring(0, 19);
      }
    });

    const messageField = computed(() => {
      if (!props.row) return "";
      // Try common log message field names (strings only — `_source` is an
      // object in Elasticsearch-shaped payloads and would stringify to
      // "[object Object]" via `String(...)`).
      for (const key of ["log", "message", "msg", "body", "content"]) {
        const val = props.row[key];
        if (val && typeof val !== "object") return String(val);
      }
      // `_source` tends to be a nested object; prefer its inner message field
      // and fall back to a compact JSON preview.
      const src = props.row._source;
      if (src && typeof src === "object") {
        for (const key of ["log", "message", "msg", "body", "content"]) {
          const val = (src as Record<string, unknown>)[key];
          if (val && typeof val !== "object") return String(val);
        }
        return JSON.stringify(src).substring(0, 120);
      }
      // Fallback: stringify first non-timestamp field
      const keys = Object.keys(props.row).filter(
        (k) => !k.startsWith("_") && k !== "log" && k !== "timestamp",
      );
      if (keys.length > 0) {
        const val = props.row[keys[0]];
        if (typeof val !== "object") return String(val);
      }
      // Last-resort fallback: stringify up to the first 5 keys so we don't
      // pay O(row) for log payloads with hundreds of fields. 120 chars is
      // already the truncation budget downstream.
      const sample = Object.fromEntries(
        Object.entries(props.row).slice(0, 5),
      );
      return JSON.stringify(sample).substring(0, 120);
    });

    const truncatedMessage = computed(() => {
      const msg = messageField.value;
      return msg.length > 120 ? msg.substring(0, 117) + "..." : msg;
    });

    const severityLabel = computed(() => {
      if (!props.row) return "";
      const val =
        props.row.level ||
        props.row.severity ||
        props.row.log_level ||
        props.row.severity_text;
      return val ? String(val).toUpperCase() : "";
    });

    const severityClass = computed(() => {
      const s = severityLabel.value.toLowerCase();
      if (s.includes("error") || s.includes("fatal") || s.includes("crit"))
        return "mobile-log-card--error";
      if (s.includes("warn")) return "mobile-log-card--warn";
      if (s.includes("info")) return "mobile-log-card--info";
      if (s.includes("debug") || s.includes("trace"))
        return "mobile-log-card--debug";
      return "";
    });

    return {
      formattedTime,
      truncatedMessage,
      severityLabel,
      severityClass,
    };
  },
});
</script>

<style scoped lang="scss">
.mobile-log-card {
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 4px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 150ms ease;
  // Left border accent for severity
  border-left: 3px solid transparent;

  &:active {
    background: var(--o2-hover-accent);
  }

  &--error {
    border-left-color: var(--o2-status-error-text);
  }

  &--warn {
    border-left-color: var(--o2-status-warning-text);
  }

  &--info {
    border-left-color: var(--o2-status-info-text);
  }

  &--debug {
    border-left-color: var(--o2-text-muted);
  }

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  &__timestamp {
    font-family: monospace;
    font-size: 11px;
    color: var(--o2-text-muted);
    letter-spacing: 0.02em;
  }

  &__severity {
    font-family: monospace;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--o2-text-secondary);
  }

  &__body {
    font-family: monospace;
    font-size: 12px;
    line-height: 1.4;
    color: var(--o2-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
