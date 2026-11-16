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

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { packScopeValue } from "@/composables/starterPacks/packCopy";
import { staleSinceText, type StreamHealth } from "@/composables/starterPacks/usePackHealth";
import type { StarterPackPage } from "@/composables/starterPacks/useStarterPackPage";
import { raw, useI18nTyped } from "@/types/i18n";
import StarterPackFieldMapping from "./StarterPackFieldMapping.vue";
import { DOT_CLASS, STREAM_STATE_KEY } from "./streamHealthDisplay";

const STREAM_TYPES = ["logs", "metrics", "traces"] as const;

const props = defineProps<{ page: StarterPackPage }>();

const { t } = useI18nTyped();
const router = useRouter();
const flow = props.page.flow;

const manager = computed(() =>
  props.page.installed.value ? props.page.canManage.value : flow.isAdmin.value,
);
const scope = computed(() => packScopeValue(t, props.page.matcher.clusters.value));
const rows = computed(() => props.page.streamHealth.value);
const typeLabel = (type: string) =>
  (STREAM_TYPES as readonly string[]).includes(type)
    ? t(`starterPacks.packDetails.type.${type as (typeof STREAM_TYPES)[number]}`)
    : raw(type || "—");
const stateText = (row: StreamHealth) =>
  row.state === "stopped"
    ? t("starterPacks.page.streams.stoppedSince", { since: raw(staleSinceText(row.lastUs)) })
    : t(STREAM_STATE_KEY[row.state]);

const columns = computed<OTableColumnDef<StreamHealth>[]>(() => [
  { id: "name", header: t("starterPacks.page.streams.colStream"), accessorKey: "name", size: 340 },
  { id: "type", header: t("common.type"), size: 110 },
  { id: "state", header: t("common.status"), size: 200 },
  { id: "last", header: t("starterPacks.page.streams.colLastData"), size: 160 },
  { id: "open", header: raw(""), size: 150 },
]);

const openStreams = () =>
  router.push({ name: "logstreams", query: { org_identifier: flow.org } }).catch(() => {});
</script>

<template>
  <OContent y class="flex flex-col gap-4">
    <p
      v-if="flow.pack.clusterScoped"
      class="text-text-secondary flex items-center gap-2 text-sm"
      data-test="starter-pack-page-scope"
    >
      <OIcon name="dns" size="sm" />
      {{ t("starterPacks.page.streams.watches") }}
      <strong class="text-text-heading font-medium">{{ scope }}</strong>
    </p>
    <section class="flex flex-col gap-2">
      <h3 class="text-text-heading text-sm font-semibold">
        {{ t("starterPacks.page.streams.title") }}
      </h3>
      <OTable
        :data="rows"
        :columns="columns"
        row-key="name"
        pagination="none"
        :show-global-filter="false"
        :frame="false"
        :empty-message="t('starterPacks.page.streams.empty')"
        data-test="starter-pack-page-streams"
      >
        <template #cell-name="{ row }">
          <span class="text-text-heading truncate font-mono text-xs">{{ row.name }}</span>
        </template>
        <template #cell-type="{ row }">{{ typeLabel(row.type) }}</template>
        <template #cell-state="{ row }">
          <span
            class="flex items-center gap-2"
            :data-test="`starter-pack-page-stream-state-${row.state}`"
          >
            <span class="size-1.5 shrink-0 rounded-full" :class="DOT_CLASS[row.state]" />
            {{ stateText(row) }}
          </span>
        </template>
        <template #cell-last="{ row }">{{
          row.lastUs ? raw(staleSinceText(row.lastUs)) : raw("—")
        }}</template>
        <template #cell-open>
          <OButton
            variant="ghost-primary"
            size="xs"
            icon-left="open-in-new"
            data-test="starter-pack-page-open-streams"
            @click="openStreams"
          >
            {{ t("starterPacks.packDetails.openInStreams") }}
          </OButton>
        </template>
      </OTable>
    </section>
    <StarterPackFieldMapping :flow="flow" :manager="manager" :locked="page.installed.value" />
  </OContent>
</template>
