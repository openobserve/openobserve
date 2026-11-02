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
    <div class="flex items-center gap-1">
      <h2 class="text-text-heading text-base font-bold">{{ t("rum.overviewPage.pagesTitle") }}</h2>
      <OPopover
        v-model:open="aboutOpen"
        side="bottom"
        align="start"
        :aria-label="t('rum.overviewPage.pagesAbout')"
      >
        <template #trigger>
          <OButton
            variant="ghost"
            size="xs"
            icon-left="info-outline"
            data-test="rum-overview-pages-about"
          >
            <span class="max-md:sr-only">{{ t("rum.overviewPage.pagesAbout") }}</span>
          </OButton>
        </template>
        <p
          class="w-96 max-w-[calc(100vw-1.5rem)] p-3 leading-5"
          data-test="rum-overview-pages-hint"
        >
          <OText variant="meta">{{ t("rum.overviewPage.pagesHint") }}</OText>
        </p>
      </OPopover>
      <router-link
        :to="allPagesLink"
        class="text-text-link ms-auto text-sm font-bold"
        :aria-label="t('rum.overviewPage.pagesAllLinkAria')"
        data-test="rum-overview-pages-all-link"
      >
        {{ t("rum.overviewPage.pagesAllLink") }} →
      </router-link>
    </div>
    <div role="region" :aria-label="t('rum.overviewPage.pagesTableLabel')">
      <OTable
        :data="visible"
        :columns="columns"
        :default-columns="false"
        row-key="path"
        pagination="none"
        sorting="none"
        :show-global-filter="false"
        :frame="false"
        data-test="rum-overview-pages-table"
      >
        <template #cell-path="{ row, index }">
          <router-link
            :to="sessionsLink(pageFilter(row.path, schema))"
            class="text-text-link inline-block min-h-6 font-mono font-semibold"
            :aria-label="t('rum.overviewPage.pagesOpenSessions', { path: raw(row.path) })"
            :data-test="`rum-overview-pages-link-${index}`"
          >
            {{ row.path }}
          </router-link>
        </template>
        <template #cell-views="{ row }">{{ formatCount(row.views) }}</template>
        <template #cell-lcp="{ row }">
          <MarkedValue
            :band="bandOf('lcp', row.lcp)"
            :text="raw(formatVital('lcp', row.lcp))"
            :class="BAND_TEXT[bandOf('lcp', row.lcp) ?? 'good']"
          />
        </template>
        <template #cell-inp="{ row }">
          <MarkedValue
            :band="bandOf('inp', row.inp)"
            :text="raw(formatVital('inp', row.inp))"
            :class="BAND_TEXT[bandOf('inp', row.inp) ?? 'good']"
          />
        </template>
        <template #cell-cls="{ row }">
          <MarkedValue
            :band="bandOf('cls', row.cls)"
            :text="raw(formatVital('cls', row.cls))"
            :class="BAND_TEXT[bandOf('cls', row.cls) ?? 'good']"
          />
        </template>
        <template #cell-errors="{ row, index }">
          <router-link
            :to="errorsLink(pageFilter(row.path, schema))"
            class="text-text-link inline-block min-h-6"
            :aria-label="
              t('rum.overviewPage.pagesOpenErrors', { count: formatCount(row.errors) }, row.errors)
            "
            :data-test="`rum-overview-pages-errors-link-${index}`"
          >
            {{ formatCount(row.errors) }}
          </router-link>
        </template>
        <template #cell-impact="{ row }">
          <span role="img" :aria-label="t('rum.overviewPage.pagesImpactAria', { n: row.impact })">
            <ODataBarCell :value="row.impact" :max="100" :display="row.impact" />
          </span>
        </template>
      </OTable>
    </div>
    <div v-if="pages.length > LIMIT" class="mt-2">
      <OButton
        variant="ghost"
        size="sm"
        :aria-expanded="expanded"
        data-test="rum-overview-pages-toggle"
        @click="expanded = !expanded"
      >
        {{
          expanded
            ? t("rum.overviewPage.pagesShowFewer")
            : t("rum.overviewPage.pagesShowAll", { n: pages.length })
        }}
      </OButton>
    </div>
    <p class="text-text-secondary mt-2 text-xs">
      {{ t("rum.overviewPage.pagesLegend", { n: MIN_VIEWS }) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { RouteLocationRaw } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import MarkedValue from "@/components/rum/performance/overview/MarkedValue.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  MIN_VIEWS,
  bandOf,
  formatCount,
  formatVital,
  pageFilter,
  type Band,
  type PageRow,
} from "@/utils/rum/performanceOverview";

const LIMIT = 10;

const props = defineProps<{
  pages: PageRow[];
  sessionsLink: (filter: string) => RouteLocationRaw;
  errorsLink: (filter: string) => RouteLocationRaw;
  allPagesLink: RouteLocationRaw;
  schema: Set<string>;
}>();
const { t } = useI18nTyped();
const expanded = ref(false);
const aboutOpen = ref(false);
const visible = computed(() => (expanded.value ? props.pages : props.pages.slice(0, LIMIT)));

const BAND_TEXT: Record<Band, string> = {
  good: "text-text-body",
  needs: "text-status-warning-text",
  poor: "text-status-error-text",
};

const columns = computed<OTableColumnDef<PageRow>[]>(() => [
  {
    id: "path",
    header: t("rum.overviewPage.pagesColPage"),
    size: 240,
    meta: { fillRemaining: true },
  },
  {
    id: "views",
    header: t("rum.overviewPage.pagesColViews"),
    accessorKey: "views",
    size: 80,
    meta: { align: "right" },
  },
  {
    id: "lcp",
    header: t("rum.overviewPage.pagesColLcp"),
    accessorKey: "lcp",
    size: 100,
    meta: { align: "right" },
  },
  {
    id: "inp",
    header: t("rum.overviewPage.pagesColInp"),
    accessorKey: "inp",
    size: 100,
    meta: { align: "right" },
  },
  {
    id: "cls",
    header: t("rum.overviewPage.pagesColCls"),
    accessorKey: "cls",
    size: 80,
    meta: { align: "right" },
  },
  {
    id: "errors",
    header: t("rum.overviewPage.pagesColErrors"),
    accessorKey: "errors",
    size: 80,
    meta: { align: "right" },
  },
  { id: "impact", header: t("rum.overviewPage.pagesColImpact"), accessorKey: "impact", size: 150 },
]);
</script>
