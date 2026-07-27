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
  - Colors from the --color-status-* design tokens.
-->
<template>
  <span
    v-if="!displayValue"
    data-test="span-status-code-badge-empty"
    class="text-status-neutral-text"
  >
    —
  </span>
  <OTag
    v-else
    data-test="span-status-code-badge"
    :type="badgeType"
    :value="badgeValue"
    :label="displayValue"
    :dot="false"
    class="font-mono tabular-nums"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { httpStatusBucket, grpcStatusKey } from "@/lib/core/Badge/badgeGroups";

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

const badgeType = computed(() => (source.value === "grpc" ? "spanStatus" : "httpStatus"));

const badgeValue = computed(() => {
  if (source.value === "http") return httpStatusBucket(props.code);
  if (source.value === "grpc") return grpcStatusKey(props.grpcCode);
  return "";
});
</script>
