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
  <div class="relative flex flex-col gap-3 px-3 py-2" data-test="downtime-preview">
    <OInnerLoading :showing="loading" size="sm" />
    <p v-if="error" class="text-input-error-text text-xs" data-test="downtime-preview-error">
      {{ t("alerts.downtimes.preview.failed") }}
    </p>

    <div
      v-for="block in blocks"
      :key="block.module"
      class="flex flex-col gap-1"
      :data-test="`downtime-preview-${block.module}`"
    >
      <div class="flex items-center gap-2">
        <OIcon :name="MODULE_ICONS[block.module]" size="xs" class="text-text-secondary" />
        <span class="text-text-heading text-xs font-semibold">
          {{ t(MODULE_LABEL_KEYS[block.module]) }}
        </span>
        <span class="text-text-body ms-auto text-xs tabular-nums">{{ block.total }}</span>
      </div>
      <ul class="flex flex-col gap-0.5 ps-5">
        <li
          v-for="match in shown(block.matches)"
          :key="match.id"
          class="text-text-body truncate text-xs"
        >
          {{ match.name }}
        </li>
        <li v-if="hidden(block) > 0" class="text-text-secondary text-xs">
          {{ t("alerts.downtimes.preview.andMore", { count: hidden(block) }) }}
        </li>
        <li v-if="block.total === 0" class="text-text-muted text-xs">
          {{ t("alerts.downtimes.preview.noMatch") }}
        </li>
      </ul>
    </div>

    <p
      v-if="preview && modules.includes('alerts') && preview.resolved_at_fire_time.length"
      class="text-text-secondary text-xs"
      data-test="downtime-preview-fire-time"
    >
      {{
        t(
          "alerts.downtimes.preview.fireTime",
          { count: preview.resolved_at_fire_time.length },
          preview.resolved_at_fire_time.length,
        )
      }}
    </p>

    <div
      v-for="group in undecidable"
      :key="group.key"
      class="flex flex-col gap-1"
      data-test="downtime-preview-undecidable"
    >
      <span class="text-status-warning-text text-xs font-semibold">
        {{ t("alerts.downtimes.preview.undecidable", { key: group.key }) }}
      </span>
      <ul class="flex flex-col gap-0.5 ps-5">
        <li v-for="match in group.matches" :key="match.id" class="text-text-body truncate text-xs">
          {{ match.name }}
        </li>
      </ul>
    </div>

    <OButton
      v-if="canExpand"
      class="self-start"
      variant="ghost-primary"
      size="xs"
      data-test="downtime-preview-toggle-full"
      @click="full = !full"
    >
      {{ full ? t("alerts.downtimes.preview.showLess") : t("alerts.downtimes.preview.showAll") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { PreviewMatch, PreviewResponse, TargetModule } from "@/services/downtimes";
import { MODULE_ICONS, MODULE_LABEL_KEYS, MODULE_ORDER } from "@/utils/downtimes/targetSummary";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";

const SHORT_LIST = 5;

const props = withDefaults(
  defineProps<{
    modules: TargetModule[];
    preview: PreviewResponse | null;
    loading?: boolean;
    error?: boolean;
  }>(),
  { loading: false, error: false },
);

const { t } = useI18nTyped();
const full = ref(false);

interface Block {
  module: TargetModule;
  matches: PreviewMatch[];
  total: number;
}

const byModule = (p: PreviewResponse, m: TargetModule): Block => {
  switch (m) {
    case "anomaly_detections":
      return { module: m, matches: p.anomalies, total: p.anomalies_total };
    case "synthetics":
      return { module: m, matches: p.synthetics, total: p.synthetics_total };
    case "slos":
      return { module: m, matches: p.slos, total: p.slos_total };
    default:
      return { module: m, matches: p.alerts, total: p.alerts_total };
  }
};

const blocks = computed<Block[]>(() => {
  const p = props.preview;
  if (!p) return [];
  return MODULE_ORDER.filter((m) => props.modules.includes(m)).map((m) => byModule(p, m));
});

const undecidable = computed(() => {
  const byKey = new Map<string, PreviewMatch[]>();
  for (const matches of Object.values(props.preview?.undecidable ?? {})) {
    for (const match of matches) {
      const key = match.missing ?? "";
      byKey.set(key, [...(byKey.get(key) ?? []), match]);
    }
  }
  return [...byKey.entries()].map(([key, matches]) => ({ key, matches }));
});

const shown = (matches: PreviewMatch[]) => (full.value ? matches : matches.slice(0, SHORT_LIST));
const hidden = (block: Block) => block.total - shown(block.matches).length;
const canExpand = computed(() => blocks.value.some((b) => b.matches.length > SHORT_LIST));
</script>
