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

<!--
  Quality rollup for a Discovery row. A target carries N scores across
  dimensions and types, so there is no single scalar score — this is the
  health-threshold rollup: `issue` (one unhealthy dimension) or `multiple`.
  The per-dimension breakdown needs dimension detail on the row (TODO(BE)).
-->
<template>
  <span
    class="inline-flex items-center gap-1 text-xs font-medium"
    :class="isMultiple ? 'text-status-error-text' : 'text-status-warning-text'"
    data-test="discovery-quality-cell"
  >
    <OIcon :name="isMultiple ? 'report-problem' : 'warning-amber'" size="sm" />
    {{
      isMultiple
        ? t("aiObservability.discovery.quality.multiple")
        : t("aiObservability.discovery.quality.issue")
    }}
    <span v-if="issueCount > 1" class="text-text-secondary text-2xs tabular-nums">
      {{ t("aiObservability.discovery.quality.issueCount", { count: issueCount }) }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { DiscoveryQuality } from "@/services/llm-discovery.service";

defineOptions({ name: "DiscoveryQualityCell" });

const props = withDefaults(defineProps<{ quality: DiscoveryQuality; issueCount?: number }>(), {
  issueCount: 1,
});

const { t } = useI18nTyped();

const isMultiple = computed(() => props.quality === "multiple");
</script>
