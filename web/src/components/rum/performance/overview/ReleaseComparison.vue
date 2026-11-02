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
  <div>
    <h2 class="text-text-heading text-base font-bold">{{ t("rum.overviewPage.releaseTitle") }}</h2>
    <p class="text-text-secondary mt-1 text-sm">
      {{
        t("rum.overviewPage.releaseHint", {
          cur: raw(release.cur.version),
          prev: raw(release.prev.version),
        })
      }}
    </p>
    <p class="text-text-secondary mt-1 text-xs" data-test="rum-overview-release-note">
      {{ t("rum.overviewPage.releaseNote") }}
    </p>
    <p
      v-if="release.cur.predates"
      class="text-text-secondary mt-2 text-xs"
      data-test="rum-overview-release-before"
    >
      {{ t("rum.overviewPage.releaseBefore", { version: raw(release.cur.version) }) }}
    </p>
    <div class="mt-3">
      <OTable
        :data="rows"
        :columns="columns"
        :default-columns="false"
        row-key="key"
        pagination="none"
        sorting="none"
        :show-global-filter="false"
        :frame="false"
        data-test="rum-overview-release-table"
      >
        <template #cell-cur="{ row }">
          <span class="text-text-heading font-bold">{{ row.cur }}</span>
          <span
            v-if="row.tone !== 'same'"
            class="ms-1 text-xs font-semibold"
            :class="TONE[row.tone]"
            :data-test="`rum-overview-release-tone-${row.key}`"
          >
            {{ t(TONE_TEXT[row.tone]) }}
          </span>
        </template>
      </OTable>
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-x-2">
      <router-link
        :to="errorsLink(versionFilter(release.cur.version))"
        class="text-text-link text-sm font-bold"
        data-test="rum-overview-release-errors-link"
      >
        {{ t("rum.overviewPage.releaseLink", { version: raw(release.cur.version) }) }}
      </router-link>
      <span
        v-if="release.newErrors !== null"
        class="text-text-secondary text-sm"
        data-test="rum-overview-release-new-errors"
      >
        {{
          t(
            "rum.overviewPage.releaseNewErrors",
            { count: formatCount(release.newErrors) },
            release.newErrors,
          )
        }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import {
  formatCount,
  formatPercent,
  formatVital,
  releaseTone,
  versionFilter,
} from "@/utils/rum/performanceOverview";

interface Side {
  version: string;
  predates: boolean;
  sessions: number;
  errorFree: number | null;
  lcp: unknown;
  inp: unknown;
}

interface Row {
  key: string;
  label: I18nText;
  prev: I18nText;
  cur: I18nText;
  tone: "better" | "worse" | "same";
}

const props = defineProps<{
  release: { cur: Side; prev: Side; newErrors: number | null };
  errorsLink: (filter: string) => RouteLocationRaw;
}>();
const { t } = useI18nTyped();

const TONE = {
  better: "text-status-success-text",
  worse: "text-status-error-text",
} as const;
const TONE_TEXT: Record<"better" | "worse", I18nKey> = {
  better: "rum.overviewPage.releaseImproved",
  worse: "rum.overviewPage.releaseWorse",
};

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const columns = computed<OTableColumnDef<Row>[]>(() => [
  {
    id: "label",
    header: t("rum.overviewPage.releaseMetric"),
    accessorKey: "label",
    size: 90,
    meta: { fillRemaining: true },
  },
  {
    id: "prev",
    header: raw(props.release.prev.version),
    accessorKey: "prev",
    size: 80,
    meta: { align: "right" },
  },
  {
    id: "cur",
    header: raw(props.release.cur.version),
    accessorKey: "cur",
    size: 140,
    meta: { align: "right" },
  },
]);

const rows = computed<Row[]>(() => {
  const { cur, prev } = props.release;
  return [
    {
      key: "lcp",
      label: t("rum.overviewPage.releaseLcp"),
      prev: raw(formatVital("lcp", n(prev.lcp))),
      cur: raw(formatVital("lcp", n(cur.lcp))),
      tone: releaseTone(n(cur.lcp), n(prev.lcp), false, {
        cur: formatVital("lcp", n(cur.lcp)),
        prev: formatVital("lcp", n(prev.lcp)),
      }),
    },
    {
      key: "inp",
      label: t("rum.overviewPage.releaseInp"),
      prev: raw(formatVital("inp", n(prev.inp))),
      cur: raw(formatVital("inp", n(cur.inp))),
      tone: releaseTone(n(cur.inp), n(prev.inp), false, {
        cur: formatVital("inp", n(cur.inp)),
        prev: formatVital("inp", n(prev.inp)),
      }),
    },
    {
      key: "errorFree",
      label: t("rum.overviewPage.releaseErrorFree"),
      prev: raw(formatPercent(prev.errorFree)),
      cur: raw(formatPercent(cur.errorFree)),
      tone: releaseTone(cur.errorFree, prev.errorFree, true, {
        cur: formatPercent(cur.errorFree),
        prev: formatPercent(prev.errorFree),
      }),
    },
    {
      key: "sessions",
      label: t("rum.overviewPage.releaseSessions"),
      prev: raw(formatCount(prev.sessions)),
      cur: raw(formatCount(cur.sessions)),
      tone: "same",
    },
  ];
});
</script>
