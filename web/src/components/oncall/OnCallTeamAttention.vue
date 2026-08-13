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

  Every row is the server's own finding, message included — computed from the
  configuration rather than stored beside it, so it cannot drift out of
  agreement with the thing it describes. The messages are finished sentences,
  rendered verbatim; this component only sorts them, decides how many fit, and
  points each at the tab that repairs it.
-->
<template>
  <OBanner
    v-if="sorted.length"
    variant="warning"
    icon="warning-amber"
    inline-actions
    data-test="oncall-team-attention"
  >
    <div class="flex min-w-0 flex-col gap-1">
      <span class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span class="text-text-secondary text-2xs shrink-0 tracking-wide uppercase">
          {{ t("oncall.attentionHeading") }}
        </span>

        <!-- Collapsed, each finding is one truncated line sharing the row: the
             server writes finished prose, and three of those stacked turns a
             banner into a paragraph nobody finishes. -->
        <span
          v-for="risk in visible"
          :key="riskKey(risk)"
          class="flex min-w-0 flex-1 basis-64 items-baseline gap-1.5"
          :data-test="`oncall-attention-${risk.kind}`"
        >
          <span
            class="mt-1 size-1.5 shrink-0 rounded-full"
            :class="risk.severity === 'high' ? 'bg-status-error-text' : 'bg-status-warning-text'"
            aria-hidden="true"
          />
          <span
            class="text-text-body min-w-0 text-sm"
            :class="expanded ? '' : 'truncate'"
          >
            {{ raw(risk.message) }}
            <OTooltip v-if="!expanded" side="bottom" :content="raw(risk.message)" />
          </span>
          <OButton
            variant="ghost-primary"
            size="xs"
            class="shrink-0"
            :data-test="`oncall-attention-cta-${risk.kind}`"
            @click="emit('act', tabFor(risk.kind))"
          >
            {{ t(CTA_KEY[tabFor(risk.kind)]) }}
          </OButton>
        </span>

        <!-- A counter you cannot open is just a number. The rest are one click
             away rather than one screen away. -->
        <OButton
          v-if="hidden > 0 || expanded"
          variant="ghost"
          size="xs"
          class="shrink-0"
          data-test="oncall-attention-more"
          @click="expanded = !expanded"
        >
          {{ expanded ? t("oncall.attentionShowLess") : t("oncall.attentionMore", { count: hidden }) }}
        </OButton>
      </span>
    </div>
  </OBanner>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ConfigRisk, ConfigRisks } from "@/ts/interfaces/oncall";
import type { I18nKey } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<{ risks?: ConfigRisks | null; max?: number }>(), {
  risks: null,
  // Two truncated findings plus the overflow control fit one line on a laptop;
  // a third pushes the banner into a second row.
  max: 2,
});

/** Emits the tab that repairs the finding: `policy` | `schedule` | `ownership`. */
const emit = defineEmits<{ (e: "act", tab: string): void }>();

const { t } = useI18nTyped();

const expanded = ref(false);

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

/// Stable across re-sorts: two findings of one kind differ by who they name.
function riskKey(risk: ConfigRisk): string {
  return `${risk.kind}:${risk.priority ?? ""}:${risk.user_email ?? risk.rotation ?? ""}`;
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/// Severe first. The server returns them in its own order, and "nobody can be
/// reached at all" has to outrank "this rotation has one person".
const sorted = computed<ConfigRisk[]>(() =>
  [...(props.risks?.risks ?? [])].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
  ),
);

const visible = computed(() => (expanded.value ? sorted.value : sorted.value.slice(0, props.max)));

/// Counted against the server's `total`, not the list it sent: it truncates,
/// and a count describing only what arrived would quietly under-report.
const hidden = computed(() =>
  Math.max(0, (props.risks?.total ?? sorted.value.length) - visible.value.length),
);
</script>
