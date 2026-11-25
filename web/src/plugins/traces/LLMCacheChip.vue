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
  <span
    class="rounded-default text-2xs inline-flex shrink-0 items-center gap-1 border px-2 py-[0.18rem] leading-none whitespace-nowrap"
    :class="
      cache.misses
        ? 'text-status-warning-text bg-status-warning-bg border-status-warning-text/30 font-medium'
        : 'bg-surface-subtle border-border-default text-text-secondary'
    "
    :title="title"
  >
    <OIcon :name="cache.misses ? 'warning-amber' : 'cached'" size="xs" />
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { formatTokens } from "@/utils/llmUtils";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { TurnCacheUse } from "./threadView.utils";

const props = defineProps<{ cache: TurnCacheUse }>();

const { t } = useI18nTyped();

// A miss outranks the tokens the turn's other calls read or wrote.
const label = computed(() => {
  const c = props.cache;
  if (c.misses > 1) return t("traces.threadView.cacheMissCount", { n: c.misses });
  if (c.misses) return t("traces.threadView.cacheMiss");
  if (c.readTokens) return t("traces.threadView.cacheHit", { tokens: formatTokens(c.readTokens) });
  return t("traces.threadView.cacheWrite", { tokens: formatTokens(c.writeTokens) });
});

const title = computed(() =>
  t("traces.threadView.cacheDetail", {
    read: formatTokens(props.cache.readTokens),
    written: formatTokens(props.cache.writeTokens),
  }),
);
</script>
