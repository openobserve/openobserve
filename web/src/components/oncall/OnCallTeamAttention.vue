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
  The ways this team would fail to wake somebody.

  Every row is the server's own finding, message included — it is computed from
  the configuration rather than stored beside it, so it cannot drift out of
  agreement with the thing it describes. The messages are finished sentences
  and are rendered verbatim; this component's only job is to sort them, cap
  them, and point each one at the tab that repairs it.
-->
<template>
  <OBanner
    v-if="visible.length"
    variant="warning"
    icon="warning-amber"
    inline-actions
    data-test="oncall-team-attention"
  >
    <span class="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span class="text-text-secondary text-2xs tracking-wide uppercase">
        {{ t("oncall.attentionHeading") }}
      </span>

      <span
        v-for="(risk, index) in visible"
        :key="`${risk.kind}-${index}`"
        class="flex flex-wrap items-baseline gap-1.5"
        :data-test="`oncall-attention-${risk.kind}`"
      >
        <!-- Only the severe ones get colour. A banner where every row shouts is
             one nobody reads past the first line. -->
        <span
          class="text-sm"
          :class="risk.severity === 'high' ? 'text-status-error-text' : 'text-text-body'"
        >
          {{ raw(risk.message) }}
        </span>
        <OButton
          variant="ghost-primary"
          size="xs"
          :data-test="`oncall-attention-cta-${risk.kind}`"
          @click="emit('act', tabFor(risk.kind))"
        >
          {{ t(CTA_KEY[tabFor(risk.kind)]) }}
        </OButton>
      </span>

      <!-- The server truncates its own list but reports the true total, so a
           count that only described what fitted would be a quiet lie. -->
      <span
        v-if="hidden > 0"
        class="text-text-secondary text-xs"
        data-test="oncall-attention-more"
      >
        {{ t("oncall.attentionMore", { count: hidden }) }}
      </span>
    </span>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type { ConfigRisk, ConfigRisks } from "@/ts/interfaces/oncall";
import type { I18nKey } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<{ risks?: ConfigRisks | null; max?: number }>(), {
  risks: null,
  // Three fits the banner on a laptop without wrapping it into a paragraph.
  max: 3,
});

/** Emits the tab that repairs the finding: `policy` | `schedule` | `ownership`. */
const emit = defineEmits<{ (e: "act", tab: string): void }>();

const { t } = useI18nTyped();

type FixTab = "policy" | "schedule" | "ownership";

/// Which tab actually repairs each finding. A banner that states a problem and
/// leaves the reader hunting for the fix is only half a banner.
const TAB_FOR_KIND: Record<string, FixTab> = {
  priority_pages_nobody: "policy",
  ladder_last_rung_is_not_the_whole_team: "policy",
  unreachable_on_rung: "policy",
  coverage_gap: "schedule",
  single_member_rotation: "schedule",
  ownership_rule_never_matched: "ownership",
};

const CTA_KEY: Record<FixTab, I18nKey> = {
  policy: "oncall.attentionOpenPolicy",
  schedule: "oncall.attentionFillGap",
  ownership: "oncall.attentionOpenRouting",
};

function tabFor(kind: string): FixTab {
  return TAB_FOR_KIND[kind] ?? "policy";
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/// Severe first. The server returns them in its own order, and "nobody can be
/// reached at all" has to outrank "this rotation has one person".
const sorted = computed<ConfigRisk[]>(() =>
  [...(props.risks?.risks ?? [])].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
  ),
);

const visible = computed(() => sorted.value.slice(0, props.max));

/// Counted against the server's `total`, not against the list it sent: it
/// truncates, and the count has to describe everything that was found.
const hidden = computed(() =>
  Math.max(0, (props.risks?.total ?? sorted.value.length) - visible.value.length),
);
</script>
