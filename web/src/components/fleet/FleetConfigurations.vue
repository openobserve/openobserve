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
  <div class="card-container flex min-h-0 flex-1 flex-col overflow-hidden">
    <OTable
      class="min-h-0 flex-1"
      :data="rows"
      :columns="columns"
      row-key="id"
      :frame="false"
      pagination="client"
      :page-size="20"
      :show-global-filter="false"
      :persist-columns="true"
      table-id="fleet-configurations"
      :loading="loading"
      :forbidden="forbidden"
      :error="loadError"
      data-test="fleet-configurations-table"
      @row-click="openConfig"
    >
      <template #toolbar>
        <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
          <div class="min-w-0 flex-1 max-md:min-w-40">
            <OSearchInput
              v-model="search"
              class="w-full"
              size="sm"
              clearable
              :placeholder="t('fleet.configs.search')"
              data-test="fleet-configurations-search"
            />
          </div>
          <OButton
            variant="outline"
            size="sm"
            icon-left="upload-file"
            data-test="fleet-configurations-import"
            @click="fileInput?.click()"
          >
            {{ t("fleet.configs.importYaml") }}
          </OButton>
          <input
            ref="fileInput"
            type="file"
            accept=".yaml,.yml"
            class="hidden"
            data-test="fleet-configurations-import-input"
            @change="onImport"
          />
        </div>
      </template>

      <template #cell-name="{ row }">
        <div class="flex min-w-0 flex-col">
          <span class="truncate font-medium">{{ row.name }}</span>
          <span class="text-text-secondary truncate text-xs">{{ row.description }}</span>
        </div>
      </template>

      <template #cell-version="{ row }">
        <span
          v-if="row.version"
          class="tabular-nums"
          :data-test="`fleet-configurations-version-${row.id}`"
          >{{ t("fleet.common.versionShort", { version: row.version }) }}</span
        >
        <span
          v-else
          class="text-text-secondary"
          :data-test="`fleet-configurations-version-${row.id}`"
          >{{ raw("—") }}</span
        >
      </template>

      <template #cell-collectors="{ row }">
        <span v-if="row.collectors" class="tabular-nums">{{ row.collectors }}</span>
        <span v-else class="text-text-secondary">{{ raw("—") }}</span>
      </template>

      <template #cell-fleets="{ row }">
        <div
          v-if="row.fleets.length || row.fleetsHidden"
          class="flex flex-wrap items-center gap-1"
          :data-test="`fleet-configurations-fleets-${row.id}`"
        >
          <OTag
            v-for="f in row.fleets"
            :key="f.id"
            variant="default-soft"
            :label="f.name === null ? t('fleet.fleets.deletedFleet') : raw(f.name)"
          />
          <OText
            v-if="row.fleetsHidden"
            variant="meta"
            :data-test="`fleet-configurations-fleets-hidden-${row.id}`"
            >{{ t("fleet.configs.hiddenFleets", { count: row.fleetsHidden }) }}</OText
          >
        </div>
        <span v-else class="text-text-secondary">{{ raw("—") }}</span>
      </template>

      <template #cell-updatedAt="{ row }">
        <div class="flex flex-col">
          <OTimeCell :value="row.updatedAt" unit="ms" mode="relative" />
          <span class="text-text-secondary truncate text-xs">{{ row.updatedBy }}</span>
        </div>
      </template>

      <template #empty>
        <div data-test="fleet-configurations-empty">
          <OEmptyState size="hero" preset="no-data" :filtered="!!search" @action="clearFilters" />
        </div>
      </template>

      <template #error>
        <div data-test="fleet-configurations-error">
          <OEmptyState size="hero" preset="load-error" @action="refresh" />
        </div>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRoute, useRouter } from "vue-router";
import { isForbidden, setPendingImport, useFleetConfigs, type ConfigRow } from "./useFleetApi";

const { t } = useI18nTyped();

const search = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const route = useRoute();
const router = useRouter();

const list = useFleetConfigs();
const loading = list.loading;
const forbidden = computed(() => isForbidden(list.error.value));
// A failed refetch keeps the stale rows on screen.
const loadError = computed(() =>
  list.error.value && !forbidden.value && !list.rows.value.length ? String(list.error.value) : null,
);
const refresh = () => list.refetch();

const rows = computed(() =>
  list.rows.value.filter((c) => c.name.includes(search.value.trim().toLowerCase())),
);

const columns = computed<OTableColumnDef<ConfigRow>[]>(() => [
  { id: "name", header: t("fleet.common.name"), accessorKey: "name", size: 340, sortable: true },
  { id: "version", header: t("fleet.collectors.version"), accessorKey: "version", size: 90 },
  {
    id: "collectors",
    header: t("fleet.tabs.collectors"),
    accessorKey: "collectors",
    size: 110,
    sortable: true,
  },
  {
    id: "fleets",
    header: t("fleet.configs.usedByFleets"),
    accessorFn: (r) => r.fleets.map((f) => f.name ?? "").join(" "),
    size: 240,
    hideable: true,
  },
  {
    id: "updatedAt",
    header: t("fleet.common.updated"),
    accessorKey: "updatedAt",
    size: 160,
    sortable: true,
    hideable: true,
  },
]);

function clearFilters() {
  search.value = "";
}

// The org lives in the URL, so a link that drops it lands the editor in the default org.
function orgQuery() {
  const org = route.query.org_identifier;
  return org ? { org_identifier: org } : {};
}

function openConfig(row: ConfigRow) {
  router.push({ name: "fleetConfigEditor", params: { id: row.id }, query: orgQuery() });
}

function onImport(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    setPendingImport(String(reader.result ?? ""));
    router.push({ name: "fleetConfigEditor", params: { id: "new" }, query: orgQuery() });
  };
  reader.readAsText(file);
  // Lets the same file be picked again.
  input.value = "";
}

defineExpose({
  create: () =>
    router.push({ name: "fleetConfigEditor", params: { id: "new" }, query: orgQuery() }),
});
</script>
