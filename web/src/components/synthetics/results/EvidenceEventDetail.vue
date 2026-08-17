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
  EvidenceEventDetail — the full record for ONE evidence event.

  Purely presentational: one prop in, no emits, no fetching. `EvidenceEvents`
  truncates a row's URL and drops fields like stack trace and resource type to
  keep the table scannable; this renders what that row could not, meant for the
  table's row-expansion slot.
-->

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { copyToClipboard } from "@/utils/clipboard";
import type { EvidenceEvent } from "@/composables/synthetics/syntheticResultsSchema";

const props = defineProps<{ event: EvidenceEvent }>();

const { t } = useI18nTyped();

/**
 * The value the row could not print: `shortUrl` strips the host and `truncate`
 * then eats the query string, so a login URL dies mid-parameter on the row.
 */
const fullValue = computed(() => {
  const e = props.event;
  return e.url ?? e.text ?? e.message ?? e.kind;
});

/**
 * Millisecond-precise, because `toLocaleString()` alone drops them and the two
 * timestamps this renders routinely differ by less than a second — printed
 * without milliseconds they read identical, hiding the exact bucketing
 * ambiguity both fields exist to expose.
 */
function absoluteTime(ms: number): string {
  return `${new Date(ms).toLocaleString()}.${String(ms % 1000).padStart(3, "0")}`;
}

interface DetailField {
  label: I18nText;
  value: I18nText;
}

/**
 * Only fields that HAVE a value. A console event carries no method, status or
 * duration; rendering those as dashes pads the panel with nothing.
 */
const fields = computed<DetailField[]>(() => {
  const e = props.event;
  const out: DetailField[] = [
    // The raw kind, not the row's badge — that collapses seven kinds into four
    // categories, so `dialog` and `crash` have no identity of their own there.
    { label: t("synthetics.evidence.detailEvent"), value: raw(e.kind) },
  ];
  if (e.method) out.push({ label: t("synthetics.evidence.colMethod"), value: raw(e.method) });
  if (e.status != null)
    out.push({ label: t("synthetics.evidence.colStatus"), value: raw(e.status) });
  if (e.durationMs != null)
    out.push({ label: t("synthetics.evidence.colDuration"), value: raw(`${e.durationMs}ms`) });
  out.push({
    label: t("synthetics.evidence.detailOccurred"),
    value: raw(absoluteTime(e.ts)),
  });
  if (e.initiatedTs != null && e.initiatedTs !== e.ts)
    out.push({
      label: t("synthetics.evidence.detailInitiated"),
      value: raw(absoluteTime(e.initiatedTs)),
    });
  if (e.resourceType)
    out.push({ label: t("synthetics.evidence.detailResourceType"), value: raw(e.resourceType) });
  if (e.level) out.push({ label: t("synthetics.evidence.detailLevel"), value: raw(e.level) });
  out.push({
    label: t("synthetics.evidence.detailOrigin"),
    value: e.firstParty
      ? t("synthetics.evidence.detailFirstParty")
      : t("synthetics.evidence.detailThirdParty"),
  });
  out.push({
    label: t("synthetics.evidence.colStep"),
    value: e.stepName ? raw(e.stepName) : t("synthetics.evidence.unattributed"),
  });
  return out;
});

function copyValue() {
  copyToClipboard(fullValue.value, t);
}

function copyStack() {
  if (props.event.stack) copyToClipboard(props.event.stack, t);
}
</script>

<template>
  <!-- No background: OTable already fills the expansion row
       (`bg-table-row-expanded-bg`), and a second fill reads as a slab on a slab. -->
  <div class="flex flex-col gap-3 px-4 py-3" data-test="synthetics-evidence-event-detail">
    <div class="flex items-start gap-2">
      <span
        class="text-text-body min-w-0 flex-1 font-mono text-xs break-all"
        data-test="synthetics-evidence-event-detail-value"
      >
        {{ fullValue }}
      </span>
      <OButton
        variant="ghost"
        size="xs"
        class="shrink-0"
        data-test="synthetics-evidence-event-detail-copy-value"
        @click="copyValue"
      >
        <OIcon name="content-copy" size="xs" />
        <OTooltip :content="t('common.copyToClipboard')" />
      </OButton>
    </div>

    <dl
      class="m-0 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-1"
      data-test="synthetics-evidence-event-detail-fields"
    >
      <template v-for="f in fields" :key="f.label">
        <dt class="text-2xs text-text-label font-medium">{{ f.label }}</dt>
        <dd class="text-text-body m-0 font-mono text-xs break-all">{{ f.value }}</dd>
      </template>
    </dl>

    <div v-if="event.stack" class="flex flex-col gap-1">
      <div class="flex items-center gap-1">
        <span class="text-2xs text-text-label font-medium">
          {{ t("synthetics.evidence.detailStackTrace") }}
        </span>
        <OButton
          variant="ghost"
          size="xs"
          data-test="synthetics-evidence-event-detail-copy-stack"
          @click="copyStack"
        >
          <OIcon name="content-copy" size="xs" />
          <OTooltip :content="t('common.copyToClipboard')" />
        </OButton>
      </div>
      <!-- Bordered, not just filled: `--color-code-bg` and
           `--color-table-row-expanded-bg` are the same value in the light theme,
           so a fill alone gives the trace no edge against the row it sits in. -->
      <pre
        class="bg-code-bg border-border-default rounded-default m-0 max-h-50 overflow-auto border p-3 font-mono text-xs leading-relaxed"
        data-test="synthetics-evidence-event-detail-stack"
        >{{ event.stack }}</pre>
    </div>
  </div>
</template>
