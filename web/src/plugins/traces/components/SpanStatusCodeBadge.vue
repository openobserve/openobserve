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
along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  SpanStatusCodeBadge
  - Prefers HTTP status code (code prop) when present; falls back to gRPC status
    code (grpcCode prop) otherwise.
  - HTTP coloring: 2xx=success, 3xx=info, 4xx=warning, 5xx=error
  - gRPC coloring: 0=success (OK), non-zero=error (any error)
  - Renders "—" when neither value is present.
  - Colors from --o2-status-* tokens defined in _variables.scss.
-->
<template>
  <span
    v-if="!displayValue"
    data-test="span-status-code-badge-empty"
    class="tw:text-[var(--o2-status-neutral-text)]"
  >
    —
  </span>
  <span
    v-else
    data-test="span-status-code-badge"
    class="tw:rounded tw:py-[0.125rem] tw:px-[0.5rem] tw:inline-flex tw:items-center tw:w-fit tw:font-mono tw:text-[0.75rem] tw:font-semibold tw:tabular-nums"
    :class="tierClass"
  >
    {{ displayValue }}
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  /** HTTP status code (e.g. 200, 404, 500) */
  code?: string | number | null;
  /** gRPC status code (0 = OK, 1–16 = error variants) */
  grpcCode?: string | number | null;
}>();

const toInt = (v: string | number | null | undefined): number | null => {
  const n = parseInt(String(v ?? ""), 10);
  return isNaN(n) ? null : n;
};

const httpNum = computed(() => {
  const n = toInt(props.code);
  return n && n > 0 ? n : null;
});

const grpcNum = computed(() => {
  const n = toInt(props.grpcCode);
  return n !== null ? n : null; // 0 is valid (OK)
});

const source = computed(() => {
  if (httpNum.value !== null) return "http" as const;
  if (grpcNum.value !== null) return "grpc" as const;
  return "none" as const;
});

const displayValue = computed(() => {
  if (source.value === "http") return String(props.code);
  if (source.value === "grpc") return String(props.grpcCode);
  return null;
});

const tierClass = computed(() => {
  if (source.value === "grpc") {
    return grpcNum.value === 0
      ? "o2-status-badge--success"
      : "o2-status-badge--error";
  }
  const n = httpNum.value;
  if (!n) return "o2-status-badge--neutral";
  if (n >= 200 && n < 300) return "o2-status-badge--success";
  if (n >= 300 && n < 400) return "o2-status-badge--info";
  if (n >= 400 && n < 500) return "o2-status-badge--warning";
  if (n >= 500 && n < 600) return "o2-status-badge--error";
  return "o2-status-badge--neutral";
});
</script>

<style scoped>
.o2-status-badge--success {
  color: var(--o2-status-success-text);
  background: var(--o2-status-success-bg);
}
.o2-status-badge--info {
  color: var(--o2-status-info-text);
  background: var(--o2-status-info-bg);
}
.o2-status-badge--warning {
  color: var(--o2-status-warning-text);
  background: var(--o2-status-warning-bg);
}
.o2-status-badge--error {
  color: var(--o2-status-error-text);
  background: var(--o2-status-error-bg);
}
.o2-status-badge--neutral {
  color: var(--o2-status-neutral-text);
  background: var(--o2-status-neutral-bg);
}
</style>
