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
  <div class="bg-card-glass-bg discovered-services flex h-full w-full flex-col">
    <!-- Loading State -->
    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <OSpinner size="sm" data-test="discovered-services-loading-indicator" />
    </div>

    <div v-else-if="error" class="flex flex-1 items-center justify-center">
      <OEmptyState size="hero" preset="load-error" :description="raw(error)" hide-action>
        <template #actions>
          <OButton
            data-test="retry-discovered-services-btn"
            variant="outline"
            size="sm-action"
            icon-left="refresh"
            @click="() => loadServices()"
          >
            {{ t("settings.correlation.retry") }}
          </OButton>
        </template>
      </OEmptyState>
    </div>

    <div v-else-if="forbidden" class="flex flex-1 items-center justify-center">
      <LicenseDeniedState
        v-if="Array.isArray(forbidden)"
        :features="forbidden"
        data-test="discovered-services-license-denied"
      />
      <OEmptyState
        v-else
        size="hero"
        preset="no-access"
        data-test="discovered-services-forbidden"
      />
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div
        v-if="versionsEnabled"
        class="mx-page-edge mt-3 grid shrink-0 grid-cols-5 gap-2"
        data-test="svcver-discovered-tiles"
      >
        <div
          v-for="tile in tiles"
          :key="tile.id"
          class="rounded-surface bg-surface-panel border-border-default flex min-w-0 flex-col gap-1 border px-3 py-2.5"
          :data-test="`svcver-tile-${tile.id}`"
        >
          <span class="text-text-secondary text-xs">{{ tile.label }}</span>
          <span
            class="flex min-w-0 items-center justify-between gap-2 max-xl:flex-col max-xl:items-start max-xl:gap-0.5"
          >
            <span class="text-text-heading text-xl font-semibold tabular-nums">{{
              tile.value
            }}</span>
            <OButton
              v-if="tile.id === 'overrides' && tile.linked"
              variant="ghost-primary"
              size="xs"
              data-test="svcver-tile-overrides-view"
              @click="$emit('navigate-to-env-versions')"
              ><span data-test="svcver-overrides-link">{{
                t("serviceVersions.discovered.tiles.view")
              }}</span></OButton
            >
            <OButton
              v-else-if="tile.id === 'names' && tile.linked"
              variant="ghost-primary"
              size="xs"
              data-test="svcver-tile-names-review"
              @click="setView('name-review')"
              >{{ t("serviceVersions.discovered.tiles.review") }}</OButton
            >
            <span v-else-if="tile.sub" class="flex min-w-0">
              <OTruncatedText
                :lines="2"
                class="text-text-secondary text-xs"
                :tooltip="tile.full ? false : undefined"
                :data-test="`svcver-tile-${tile.id}-sub`"
                >{{ tile.sub }}</OTruncatedText
              ><OTooltip v-if="tile.full" :content="tile.full" side="top" />
            </span>
          </span>
        </div>
      </div>

      <div
        v-if="versionsEnabled || !tableShown"
        class="mx-page-edge mt-3 flex shrink-0 flex-wrap items-center gap-3"
      >
        <OToggleGroup
          v-if="versionsEnabled"
          :model-value="activeView"
          :aria-label="t('serviceVersions.discovered.view.label')"
          data-test="svcver-discovered-view"
          @update:model-value="setView"
        >
          <OToggleGroupItem value="services" size="sm" data-test="svcver-discovered-view-services"
            >{{ t("serviceVersions.discovered.view.services") }}
            <span class="text-text-secondary ms-1.5 text-xs tabular-nums">{{
              raw(serviceCount)
            }}</span></OToggleGroupItem
          >
          <OToggleGroupItem
            value="name-review"
            size="sm"
            data-test="svcver-discovered-view-name-review"
            >{{ t("serviceVersions.discovered.view.nameReview") }}
            <span class="text-text-secondary ms-1.5 text-xs tabular-nums">{{
              raw(namesTotal ?? "–")
            }}</span></OToggleGroupItem
          >
        </OToggleGroup>
        <span
          v-if="versionsEnabled"
          tabindex="0"
          role="img"
          class="text-text-muted rounded-default inline-flex shrink-0"
          :aria-label="t('serviceVersions.discovered.banner')"
          data-test="svcver-discovered-help"
          ><OIcon name="info-outline" size="sm" /><OTooltip
            :content="t('serviceVersions.discovered.banner')"
            side="top"
        /></span>
        <!-- The table toolbar owns these while the table is on screen. -->
        <div v-if="!tableShown" class="ms-auto flex items-center gap-2">
          <OButton
            v-if="activeView === 'services'"
            data-test="reset-discovered-services-btn"
            variant="outline"
            size="sm"
            :loading="resetting"
            @click="confirmResetServices"
          >
            {{ t("settings.correlation.resetServices") }}
            <OTooltip :content="t('settings.correlation.resetServicesTooltip')" side="top" />
          </OButton>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="lastLoadedAt"
            :loading="refreshing"
            data-test="refresh-discovered-services-btn"
            @click="refreshAll"
          />
        </div>
      </div>

      <ServiceNameReview
        v-if="activeView === 'name-review'"
        class="mt-3"
        :services="services"
        :scopes="scopes"
        :trace-names="traceNames"
        :can-edit="canEdit"
        @changed="loadServices(true)"
      />
      <div v-else-if="services.length === 0" class="flex flex-1 items-center justify-center">
        <OEmptyState
          size="hero"
          preset="no-discovered-services"
          :title="t('settings.correlation.noServicesYet')"
          :description="t('settings.correlation.noServicesDescription')"
          data-test="discovered-services-empty-state"
        />
      </div>
      <template v-else>
        <OBanner
          v-if="!versionsEnabled"
          variant="info"
          icon="info"
          inline-actions
          class="mx-page-edge mt-3 shrink-0"
          :content="t('settings.correlation.discoveredServicesDescription')"
        >
          <template #actions>
            <OButton
              variant="outline"
              size="sm-action"
              data-test="discovered-services-go-to-configuration"
              @click="$emit('navigate-to-configuration')"
            >
              {{ t("settings.correlation.goToConfiguration") }}
            </OButton>
          </template>
        </OBanner>
        <div class="min-h-0 flex-1 overflow-hidden">
          <OTable
            :frame="false"
            :data="refreshing ? [] : flatRows"
            :columns="columns"
            :loading="refreshing"
            :forbidden="forbidden"
            row-key="id"
            pagination="server"
            :total-count="filteredGroupCount"
            :page-size="pageSize"
            :page-size-options="[20, 50, 100, 250, 500]"
            sorting="server"
            :sort-by="sortColumn"
            :sort-order="sortOrder"
            filter-mode="client"
            :default-columns="false"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="settings-discovered-services-v2"
            :show-global-filter="false"
            :pivot-row-columns="[{ name: '__group' }, { name: 'service_name' }]"
            :current-page="shownPage"
            wrap
            data-test="services-list-table"
            @sort-change="onSortChange"
            @row-click="handleRowClick"
            @pagination-change="onPageChange"
          >
            <template #toolbar>
              <OSearchInput
                v-model="searchQuery"
                class="min-w-60 flex-1"
                :placeholder="
                  versionsEnabled
                    ? t('serviceVersions.discovered.search')
                    : t('settings.correlation.searchServiceName')
                "
                data-test="service-search-input"
                clearable
              />
              <div class="w-44 shrink-0">
                <OSelect
                  v-model="filterKey"
                  :options="allKeys"
                  labelKey="label"
                  valueKey="value"
                  clearable
                  searchable
                  :placeholder="t('settings.correlation.selectFieldPlaceholder')"
                  :aria-label="t('settings.correlation.filterBy')"
                  data-test="service-filter-key"
                  @update:model-value="filterValue = null"
                />
              </div>
              <div class="w-44 shrink-0">
                <OSelect
                  v-model="filterValue"
                  :options="allValues"
                  clearable
                  searchable
                  :disabled="!filterKey"
                  :placeholder="t('settings.correlation.selectValuePlaceholder')"
                  data-test="service-filter-value"
                />
                <OTooltip
                  v-if="!filterKey"
                  :content="t('settings.correlation.selectFieldFirst')"
                  side="top"
                />
              </div>
            </template>
            <template #toolbar-trailing>
              <OButton
                v-if="activeView === 'services'"
                data-test="reset-discovered-services-btn"
                variant="outline"
                size="sm"
                :loading="resetting"
                @click="confirmResetServices"
              >
                {{ t("settings.correlation.resetServices") }}
                <OTooltip :content="t('settings.correlation.resetServicesTooltip')" side="top" />
              </OButton>
              <ORefreshButton
                layout="inline"
                variant="outline"
                :last-run-at="lastLoadedAt"
                :loading="refreshing"
                data-test="refresh-discovered-services-btn"
                @click="refreshAll"
              />
            </template>
            <template #empty>
              <OEmptyState
                size="hero"
                preset="no-discovered-services"
                :filtered="!!searchQuery"
                :hide-action="!searchQuery"
                @action="(id) => id === 'clear-filters' && (searchQuery = '')"
              />
            </template>
            <template #cell-service_name="{ row }">
              <div class="flex min-w-0 items-center gap-1.5">
                <button
                  v-if="row.__type === 'summary' || row.__groupSize > 1"
                  type="button"
                  data-test="service-collapse-toggle"
                  class="rounded-default text-text-secondary hover:bg-table-row-hover-bg hover:text-text-body inline-flex h-4.5 w-4.5 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0"
                  :aria-expanded="row.__type === 'summary' ? 'false' : 'true'"
                  @click.stop="toggleServiceCollapse(row.__group)"
                >
                  <OIcon
                    :name="row.__type === 'summary' ? 'chevron-right' : 'expand-more'"
                    size="sm"
                  />
                </button>
                <ServiceNameLabel
                  :service-key="row.service_name"
                  :display-name="row.display_name"
                  :display-source="row.display_source"
                  :candidates="row.display_candidates"
                  :qualifier="row.display_qualifier"
                  layout="stacked"
                  primary-class="font-semibold"
                  secondary-class="text-xs"
                  wrap-detected
                  :can-review="versionsEnabled"
                />
              </div>
            </template>
            <template #cell-workload="{ row }">
              <OTag v-if="row.__type === 'summary'" type="countChip" value="neutral">
                {{ row.instanceCount }}
                {{
                  row.instanceCount === 1
                    ? t("settings.correlation.instanceSingular")
                    : t("settings.correlation.instancePlural")
                }}
              </OTag>
              <OTag v-else variant="default-outline" size="sm" class="max-w-full min-w-0"
                ><OTruncatedText>{{ row.set_id }}</OTruncatedText></OTag
              >
            </template>
            <template #cell-k8s_workload="{ row }">
              <span v-if="row.__type === 'summary'" class="text-text-muted text-xs">{{
                raw("—")
              }}</span>
              <OTruncatedText
                v-else-if="workloadOf(row)"
                class="font-mono text-xs"
                data-test="svcver-discovered-workload"
                >{{ workloadOf(row) }}</OTruncatedText
              >
              <OTruncatedText
                v-else-if="proposedWorkloadText(row)"
                class="text-text-muted text-xs"
                data-test="svcver-discovered-workload-proposed"
                >{{ proposedWorkloadText(row) }}</OTruncatedText
              >
              <span v-else class="text-xs" data-test="svcver-discovered-no-workload"
                ><NotComparedMark :reason="t('serviceVersions.discovered.noWorkload')"
              /></span>
            </template>
            <template #cell-identity="{ row }">
              <span v-if="row.__type === 'summary'" class="text-text-muted text-xs">&mdash;</span>
              <span
                v-else-if="Object.keys(row.disambiguation).length === 0"
                class="no-dimensions-text text-xs"
                ><NotComparedMark :reason="t('settings.correlation.noDimensions')"
              /></span>
              <OnCallFitChips
                v-else
                :items="identityChips(row.disambiguation)"
                :tooltip="chipsTooltip(identityChips(row.disambiguation))"
                class="py-1"
                data-test="svcver-discovered-identity"
              >
                <template #item="{ item }">
                  <ODimensionChip
                    :dim-key="item.key"
                    :key-label="dimensionLabel(item.key, t, true)"
                    :value="item.value"
                    :variant="IDENTITY_CHIP_VARIANT"
                  />
                </template>
              </OnCallFitChips>
            </template>
            <template #cell-telemetry="{ row }">
              <OnCallFitChips
                :items="telemetryChips(row)"
                :tooltip="chipsTooltip(telemetryChips(row))"
                class="instance-telemetry-row py-1"
              >
                <template #item="{ item }">
                  <OTag type="streamType" :value="item.key">{{ item.label }}</OTag>
                  <OTooltip
                    v-if="item.streams.length"
                    :content="raw(item.streams.join(', '))"
                    content-class="text-xs"
                  />
                </template>
              </OnCallFitChips>
            </template>
            <template #cell-env="{ row }"
              ><span v-if="row.__type === 'summary'" class="text-text-muted text-xs">{{
                raw("—")
              }}</span
              ><ServiceEnvChip
                v-else-if="scopeFor(row)"
                :identity="scopeFor(row)!"
                :service="scopeFor(row)!.service"
                hide-key
                hide-inferred /><span v-else class="text-xs"
                ><NotComparedMark :reason="t(scopeGap(row))" /></span
            ></template>
            <template #cell-version="{ row }"
              ><span v-if="row.__type === 'summary'" class="text-text-muted text-xs">{{
                raw("—")
              }}</span
              ><OTruncatedText
                v-else-if="scopeFor(row)?.newest_version"
                class="font-mono text-xs"
                >{{ scopeFor(row)!.newest_version }}</OTruncatedText
              ><span v-else class="text-xs" data-test="svcver-discovered-no-version"
                ><NotComparedMark
                  :reason="
                    t(scopeFor(row) ? 'serviceVersions.catalog.notTracked' : scopeGap(row))
                  " /></span
            ></template>
            <template #cell-last_seen="{ row }">
              <OTimeCell
                :value="row.lastSeen"
                unit="us"
                :timezone="store.state.timezone"
                class="text-xs"
              />
            </template>

            <!-- The pager counts services; instances are the one count it cannot say. -->
            <template v-if="totalInstances > filteredGroupCount" #footer-note>
              <span class="max-md:hidden" data-test="discovered-services-footer-instances">
                {{
                  t(
                    "serviceVersions.discovered.footerInstances",
                    { count: totalInstances.toLocaleString(locale) },
                    totalInstances,
                  )
                }}
              </span>
            </template>
          </OTable>
        </div>
      </template>
    </div>

    <!-- Service detail side panel -->
    <ODrawer
      bleed
      :open="!!selectedService"
      @update:open="
        (val) => {
          if (!val) selectedService = null;
        }
      "
      size="lg"
      :title="raw(selectedService ? displayOf(selectedService) : undefined)"
      data-test="service-side-panel"
    >
      <template #header-right>
        <OTag variant="default-outline" size="sm">{{ selectedService?.set_id }}</OTag>
      </template>

      <!-- Default set warning banner -->
      <div
        v-if="selectedService?.set_id === 'default'"
        class="panel-warning-banner bg-banner-warning-bg border-b-banner-warning-border text-banner-warning-text flex items-start gap-2.5 border-b px-5 py-3"
      >
        <OIcon name="info-outline" size="sm" class="mt-0.5 shrink-0" />
        <div class="text-xs leading-relaxed">
          <span class="font-semibold">{{ t("settings.correlation.defaultSetWarningTitle") }}</span>
          {{ t("settings.correlation.defaultSetWarningBody") }}
        </div>
      </div>

      <OSeparator />

      <!-- Scrollable body -->
      <div class="panel-body flex-1 overflow-y-auto p-0">
        <!-- Instance Identity -->
        <div class="panel-block border-b-border-default border-b px-5 py-4">
          <div
            class="panel-block-label text-text-label mb-2.5 text-xs font-semibold tracking-normal normal-case"
          >
            {{ t("settings.correlation.instanceIdentity") }}
          </div>
          <div
            v-if="selectedService && Object.keys(selectedService.disambiguation).length > 0"
            class="flex flex-wrap gap-1.5"
          >
            <ODimensionChip
              v-for="[key, value] in Object.entries(selectedService.disambiguation).sort(
                ([a], [b]) => a.localeCompare(b),
              )"
              :key="`${key}=${value}`"
              :dim-key="key"
              :key-label="dimensionLabel(key, t)"
              :value="value"
              :variant="IDENTITY_CHIP_VARIANT"
            />
          </div>
          <div v-else class="panel-empty-text text-compact text-text-muted italic">
            {{ t("settings.correlation.noDimensionsCatchAll") }}
          </div>
        </div>

        <!-- Stream Sources -->
        <div class="panel-block border-b-border-default border-b px-5 py-4">
          <div
            class="panel-block-label text-text-label mb-2.5 text-xs font-semibold tracking-normal normal-case"
          >
            {{ t("settings.correlation.streamSources") }}
          </div>
          <div class="flex flex-col gap-3">
            <!-- Logs -->
            <div v-if="selectedService && selectedService.logs_streams.length > 0">
              <div class="panel-signal-row flex items-start gap-3">
                <OTag type="streamType" :value="'logs'" class="panel-signal-type" />
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="stream in selectedService.logs_streams"
                    :key="stream"
                    class="stream-name-badge rounded-default text-2xs bg-surface-subtle text-text-body border-border-default inline-flex items-center border px-[0.4375rem] py-[0.0625rem] font-mono whitespace-nowrap"
                    >{{ stream }}</span
                  >
                </div>
              </div>
            </div>

            <!-- Traces -->
            <div v-if="selectedService && selectedService.traces_streams.length > 0">
              <div class="panel-signal-row flex items-start gap-3">
                <OTag type="streamType" :value="'traces'" class="panel-signal-type" />
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="stream in selectedService.traces_streams"
                    :key="stream"
                    class="stream-name-badge rounded-default text-2xs bg-surface-subtle text-text-body border-border-default inline-flex items-center border px-[0.4375rem] py-[0.0625rem] font-mono whitespace-nowrap"
                    >{{ stream }}</span
                  >
                </div>
              </div>
            </div>

            <!-- Metrics -->
            <div v-if="selectedService && selectedService.metrics_streams.length > 0">
              <div class="panel-signal-row flex items-start gap-3">
                <OTag type="streamType" :value="'metrics'" class="panel-signal-type" />
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="stream in selectedService.metrics_streams"
                    :key="stream"
                    class="stream-name-badge rounded-default text-2xs bg-surface-subtle text-text-body border-border-default inline-flex items-center border px-[0.4375rem] py-[0.0625rem] font-mono whitespace-nowrap"
                    >{{ stream }}</span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Field Name Mapping -->
        <div
          v-if="selectedService && Object.keys(selectedService.field_name_mapping ?? {}).length > 0"
          class="panel-block border-b-border-default border-b px-5 py-4"
        >
          <div
            class="panel-block-label text-text-label mb-2.5 text-xs font-semibold tracking-normal normal-case"
          >
            {{ t("settings.correlation.fieldNameMapping") }}
          </div>
          <div class="panel-mapping-grid">
            <template
              v-for="[raw, mapped] in Object.entries(selectedService.field_name_mapping ?? {}).sort(
                ([a], [b]) => a.localeCompare(b),
              )"
              :key="raw"
            >
              <span
                class="mapping-key text-2xs rounded-default bg-surface-subtle text-text-body border-border-default border px-1.5 py-[0.0625rem] font-mono whitespace-nowrap"
                >{{ raw }}</span
              >
              <OIcon name="arrow-forward" size="xs" class="text-text-muted justify-self-center" />
              <span
                class="mapping-val text-2xs rounded-default bg-badge-success-soft-bg text-badge-success-soft-text border-badge-success-ol-border border px-1.5 py-[0.0625rem] font-mono whitespace-nowrap"
                >{{ mapped }}</span
              >
            </template>
          </div>
        </div>
      </div>
    </ODrawer>

    <ConfirmDialog
      :title="t('settings.correlation.resetServicesConfirmTitle')"
      :message="t('settings.correlation.resetServicesConfirmBody')"
      :ok-label="t('settings.correlation.resetServices')"
      ok-variant="destructive"
      @update:ok="doResetServices"
      @update:cancel="confirmResetOpen = false"
      v-model="confirmResetOpen"
    />
  </div>
</template>

<script lang="ts">
import type { Alias, Scope } from "@/services/service_versions";
import type { ServiceDisplayFields } from "@/types/serviceRef";

export type DiscoveredView = "services" | "name-review";
export interface ServiceRecord extends ServiceDisplayFields {
  id: string;
  org_id: string;
  service_name: string;
  set_id: string;
  disambiguation: Record<string, string>;
  all_dimensions: Record<string, string>;
  logs_streams: string[];
  traces_streams: string[];
  metrics_streams: string[];
  field_name_mapping: Record<string, string>;
  last_seen: number; // microseconds epoch
}

const WORKLOAD_KEYS = ["k8s-deployment", "k8s-statefulset", "k8s-daemonset", "k8s-workload"];
const SERVICE_NAME_MIN = 176;
// Width of one semibold name character, plus the collapse toggle and cell padding.
const NAME_CHAR_PX = 8;
const NAME_CELL_PAD = 56;
export const DISCOVERED_COLUMN_SIZES = {
  service_name: 296,
  workload: 104,
  identity: 192,
  telemetry: 140,
  last_seen: 120,
  k8s_workload: 104,
  env: 100,
  version: 80,
} as const;

function dimension(row: Pick<ServiceRecord, "disambiguation" | "all_dimensions">, key: string) {
  return row.disambiguation?.[key] || row.all_dimensions?.[key] || "";
}

export function displayOf(row: Pick<ServiceRecord, "service_name" | "display_name">) {
  return row.display_name || row.service_name;
}

// The name column takes the longest name's width before the flex columns share what is left.
export function serviceNameColumnSize(names: readonly string[]) {
  const longest = names.reduce((max, name) => Math.max(max, name.length), 0);
  return Math.min(
    DISCOVERED_COLUMN_SIZES.service_name,
    Math.max(SERVICE_NAME_MIN, longest * NAME_CHAR_PX + NAME_CELL_PAD),
  );
}

export function workloadOf(row: Pick<ServiceRecord, "disambiguation" | "all_dimensions">) {
  for (const key of WORKLOAD_KEYS) {
    const value = dimension(row, key);
    if (value) return value;
  }
  return "";
}

// Name review can propose a workload the row's own dimensions lack, so it is named as a proposal, not as none.
export function proposedWorkloadsOf(
  row: Pick<ServiceRecord, "service_name" | "display_name" | "disambiguation" | "all_dimensions">,
  aliases: Alias[],
): string[] {
  const namespace = dimension(row, "k8s-namespace");
  return aliases
    .filter(
      (alias) =>
        alias.kind === "k8s_workload" &&
        alias.status === "proposed" &&
        alias.canonical === displayOf(row) &&
        (!namespace || alias.scope === namespace),
    )
    .map((alias) => alias.alias)
    .sort();
}

// A row's env comes from the trace scope with its display name and place; anything looser is a guess, so no chip.
export function scopeForRow(
  row: Pick<ServiceRecord, "service_name" | "display_name" | "disambiguation" | "all_dimensions">,
  scopes: Scope[],
): Scope | null {
  const named = scopes.filter((scope) => scope.service === displayOf(row));
  const namespace = dimension(row, "k8s-namespace");
  const cluster = dimension(row, "k8s-cluster");
  if (namespace) {
    // Log detections often lack the cluster attribute; then the namespace alone must name one scope.
    const placed = named.filter(
      (scope) =>
        scope.where?.k8s_namespace === namespace &&
        (!cluster || (scope.where?.k8s_cluster || "") === cluster),
    );
    return placed.length === 1 ? placed[0] : null;
  }
  const env = dimension(row, "environment");
  const byEnv = env ? named.filter((scope) => scope.where_key === `env:${env}`) : [];
  if (byEnv.length === 1) return byEnv[0];
  return named.length === 1 && !named[0].where_key.startsWith("k8s:") ? named[0] : null;
}
</script>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import serviceStreamsService from "@/services/service_streams";
import { servicesListQuery } from "@/services/service_streams.queries";
import { serviceStreamKeys } from "@/services/service_streams.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import { useQuery } from "@tanstack/vue-query";
import config from "@/aws-exports";
import { aliasesQuery, identityQuery, servicesQuery } from "@/services/service_versions.queries";
import { useLicenseLock } from "@/composables/useFeatureLock";
import ServiceNameLabel from "@/components/shared/ServiceNameLabel.vue";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";
import ServiceNameReview from "@/components/settings/ServiceNameReview.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import NotComparedMark from "@/enterprise/components/ServiceVersions/NotComparedMark.vue";
import OnCallFitChips from "@/components/oncall/OnCallFitChips.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import { dimensionLabel } from "@/utils/dimensionLabels";
import { serviceIdentityOf, serviceNameCount } from "@/utils/serviceCount";
import { shortList } from "@/utils/shortList";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { forbiddenState, type ForbiddenState } from "@/utils/featureGate";

const props = withDefaults(defineProps<{ view?: DiscoveredView }>(), { view: "services" });
const emit = defineEmits<{
  (e: "navigate-to-configuration"): void;
  (e: "navigate-to-env-versions"): void;
  (e: "update:view", view: DiscoveredView): void;
}>();

const { t, locale } = useI18nTyped();
const versionsEnabled = config.isEnterprise === "true" || config.isCloud === "true";

// A service is one display name, the unit the tiles, the tab and the pager all count.
interface ServiceGroup {
  name: string;
  instances: ServiceRecord[];
  lastSeen: number;
}
// Identity values are plain facts here; the shared dimension palette puts some keys in warning hues.
const IDENTITY_CHIP_VARIANT: BadgeVariant = "default-soft";

const store = useStore();
const org = computed(() => String(store.state.selectedOrganization?.identifier || ""));
const user = computed(() => String(store.state.userInfo?.email || ""));
const identityEnabled = computed(() => versionsEnabled && Boolean(org.value));
const overrideTotal = useQuery(
  computed(() => ({
    ...identityQuery(org.value, user.value, "identityOverrides", { limit: 1 }),
    enabled: identityEnabled.value,
  })),
);
const envList = useQuery(
  computed(() => ({
    ...identityQuery(org.value, user.value, "identityEnvs"),
    enabled: identityEnabled.value,
  })),
);
const proposed = useQuery(
  computed(() => ({
    ...aliasesQuery(org.value, user.value, { status: "proposed", limit: 1 }),
    enabled: identityEnabled.value,
  })),
);
const workloadProposals = useQuery(
  computed(() => ({
    ...aliasesQuery(org.value, user.value, {
      kind: "k8s_workload",
      status: "proposed",
      limit: 1000,
    }),
    enabled: identityEnabled.value,
  })),
);
function proposedWorkloadText(row: ServiceRecord) {
  const names = proposedWorkloadsOf(row, workloadProposals.data.value?.aliases ?? []);
  if (!names.length) return "";
  const workloads = new Intl.ListFormat(String(locale.value), { type: "conjunction" }).format(
    names,
  );
  return t("serviceVersions.discovered.proposedWorkload", { workloads });
}
const tracesLock = useLicenseLock("traces");
const catalog = useQuery(
  computed(() => ({
    ...servicesQuery(org.value, user.value),
    enabled: identityEnabled.value && !tracesLock.locked.value,
  })),
);
const localView = ref<DiscoveredView>(props.view);
watch(
  () => props.view,
  (view) => (localView.value = view),
);
const activeView = computed<DiscoveredView>(() =>
  versionsEnabled && localView.value === "name-review" ? "name-review" : "services",
);
const scopes = computed(() => catalog.data.value?.services || []);
const traceNames = computed(() => [...new Set(scopes.value.map((scope) => scope.service))].sort());
// Unknown edit rights stay read-only; a write that comes back 403 would latch it anyway.
const canEdit = computed(() => envList.data.value?.can_edit === true);
const namesTotal = computed(() => proposed.data.value?.total);
const tableShown = computed(() => activeView.value === "services" && services.value.length > 0);
const DASH = "–";

const loading = ref(true);
const forbidden = ref<ForbiddenState>(false);
const refreshing = ref(false);
const resetting = ref(false);
const error = ref<string | null>(null);
const services = ref<ServiceRecord[]>([]);
const searchQuery = ref("");
const filterKey = ref<string | null>(null);
const filterValue = ref<string | null>(null);
const selectedService = ref<ServiceRecord | null>(null);
const pageSize = ref(20);
const lastLoadedAt = ref<number | null>(null);

interface CellChip {
  key: string;
  label: I18nText;
}

const identityChips = (dims: Record<string, string>) =>
  Object.entries(dims)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      value,
      label: raw(`${dimensionLabel(key, t)}: ${value}`),
    }));

// A collapsed service's summary row carries totals and no stream names.
const telemetryChips = (row: any) => {
  const summary = row.__type === "summary";
  const signal = (key: "logs" | "traces" | "metrics", total: number, streams: string[]) => {
    const count = summary ? total : streams.length;
    if (count <= 0) return [];
    const label = t(`settings.correlation.${key}WithCount`, { count });
    return [{ key, label, streams: summary ? [] : streams }];
  };
  return [
    ...signal("logs", row.totalLogs, row.logs_streams),
    ...signal("traces", row.totalTraces, row.traces_streams),
    ...signal("metrics", row.totalMetrics, row.metrics_streams),
  ];
};

const chipsTooltip = (chips: CellChip[]) =>
  raw(
    new Intl.ListFormat(String(locale.value), { type: "unit" }).format(
      chips.map((chip) => chip.label),
    ),
  );

const currentPage = ref(1);

watch([filterKey, filterValue, searchQuery], () => {
  currentPage.value = 1;
});

function onPageChange({ page, size }: { page: number; size?: number }) {
  if (size && size !== pageSize.value) {
    pageSize.value = size;
    currentPage.value = 1;
    return;
  }
  currentPage.value = page;
}

// Label override for internal field keys shown in the filter dropdown
const KEY_DISPLAY_LABELS: Record<string, I18nText> = {
  set_id: t("settings.correlation.workload"),
};

const allKeys = computed((): { label: I18nText; value: string }[] => {
  const keys = new Set<string>();
  keys.add("set_id");
  for (const s of services.value) {
    for (const k of Object.keys(s.disambiguation)) keys.add(k);
  }
  return [...keys]
    .sort()
    .map((k) => ({ label: KEY_DISPLAY_LABELS[k] ?? dimensionLabel(k, t), value: k }));
});

const allValues = computed((): string[] => {
  if (!filterKey.value) return [];
  const vals = new Set<string>();
  for (const s of services.value) {
    if (filterKey.value === "set_id") {
      vals.add(s.set_id);
    } else {
      const v = s.disambiguation[filterKey.value];
      if (v) vals.add(v);
    }
  }
  return [...vals].sort();
});

function unique(arr: string[]): string[] {
  return [...new Set(arr)];
}

// Group-level sort state (server-mode OTable: sort UI only, order is ours).
// The pivotRowColumns name-cell merge only joins CONSECUTIVE rows, so sorting
// must reorder whole service groups — never individual instance rows.
const sortColumn = ref<string>("last_seen");
const sortOrder = ref<"asc" | "desc">("desc");

function onSortChange({ column, order }: { column: string; order: "asc" | "desc" }) {
  if (column) {
    sortColumn.value = column;
    sortOrder.value = order;
  } else if (sortColumn.value === "last_seen") {
    // OTable's 3-state header cycle emits "clear" after desc. Our default IS
    // last_seen desc, so mapping clear back to the default would make the
    // Last Seen header a dead loop (desc → clear → desc …). Treat clear as
    // the missing third state instead: ascending.
    sortOrder.value = "asc";
  } else {
    sortColumn.value = "last_seen";
    sortOrder.value = "desc";
  }
}

// The first five columns keep their long-standing order; later additions go after them.
const columns = computed((): OTableColumnDef[] => [
  {
    id: "service_name",
    header: t("settings.correlation.serviceName"),
    accessorKey: "service_name",
    sortable: true,
    resizable: true,
    hideable: true,
    size: serviceNameColumnSize(services.value.map(displayOf)),
    minSize: 160,
    meta: { align: "left" },
  },
  {
    id: "workload",
    header: t("settings.correlation.workload"),
    accessorKey: "set_id",
    resizable: true,
    hideable: true,
    size: DISCOVERED_COLUMN_SIZES.workload,
    meta: { align: "left" },
  },
  {
    id: "identity",
    header: t("settings.correlation.instanceIdentity"),
    accessorKey: "identity",
    resizable: true,
    hideable: true,
    minSize: DISCOVERED_COLUMN_SIZES.identity,
    meta: { align: "left", flex: true },
  },
  {
    id: "telemetry",
    header: t("settings.correlation.telemetryCoverage"),
    accessorKey: "telemetry",
    resizable: true,
    hideable: true,
    size: DISCOVERED_COLUMN_SIZES.telemetry,
    minSize: DISCOVERED_COLUMN_SIZES.telemetry,
    meta: { align: "left", flex: true },
  },
  {
    id: "last_seen",
    header: t("settings.correlation.lastSeen"),
    accessorKey: "lastSeen",
    sortable: true,
    resizable: true,
    hideable: true,
    size: DISCOVERED_COLUMN_SIZES.last_seen,
    meta: { align: "left" },
  },
  {
    id: "k8s_workload",
    header: t("serviceVersions.discovered.cols.workload"),
    accessorKey: "k8s_workload",
    resizable: true,
    hideable: true,
    size: DISCOVERED_COLUMN_SIZES.k8s_workload,
    meta: { align: "left" },
  },
  ...(versionsEnabled
    ? [
        {
          id: "env",
          header: t("serviceVersions.discovered.cols.env"),
          accessorKey: "env",
          resizable: true,
          hideable: true,
          size: DISCOVERED_COLUMN_SIZES.env,
          meta: { align: "left" as const },
        },
        {
          id: "version",
          header: t("serviceVersions.discovered.cols.version"),
          accessorKey: "version",
          resizable: true,
          hideable: true,
          size: DISCOVERED_COLUMN_SIZES.version,
          meta: { align: "left" as const },
        },
      ]
    : []),
]);

// Per-service collapse: a collapsed service renders one aggregated summary
// row instead of its instance rows. Session-only state.
const collapsedServices = ref<Set<string>>(new Set());

function toggleServiceCollapse(name: string) {
  const next = new Set(collapsedServices.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  collapsedServices.value = next;
}

function handleRowClick(row: any) {
  if (row.__type === "summary") {
    toggleServiceCollapse(row.__group);
    return;
  }
  selectedService.value = row;
}

const serviceGroups = computed((): ServiceGroup[] => {
  // A Map, so a service named like an Object prototype key (constructor, __proto__) groups like any name.
  const groupMap = new Map<string, ServiceRecord[]>();
  for (const s of services.value) {
    const name = serviceIdentityOf(s);
    const group = groupMap.get(name);
    if (group) group.push(s);
    else groupMap.set(name, [s]);
  }

  return [...groupMap]
    .map(([name, instances]) => {
      let latestSeen = 0;
      for (const inst of instances) {
        if (inst.last_seen > latestSeen) latestSeen = inst.last_seen;
      }

      return {
        name,
        instances,
        lastSeen: latestSeen,
      };
    })
    .sort((a, b) => b.lastSeen - a.lastSeen);
});

function filterInstances(instances: ServiceRecord[]): ServiceRecord[] {
  if (!filterKey.value || !filterValue.value) return instances;
  return instances.filter((inst) => {
    if (filterKey.value === "set_id") return inst.set_id === filterValue.value;
    const v = inst.disambiguation[filterKey.value!];
    return v === filterValue.value;
  });
}

// Groups surviving the active search/filter, in display order.
const visibleGroups = computed((): ServiceGroup[] => {
  let groups = serviceGroups.value;

  if (filterKey.value && filterValue.value) {
    groups = groups
      .map((g) => ({ ...g, instances: filterInstances(g.instances) }))
      .filter((g) => g.instances.length > 0);
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    const matches = (inst: ServiceRecord) =>
      inst.service_name.toLowerCase().includes(query) ||
      displayOf(inst).toLowerCase().includes(query) ||
      inst.set_id.toLowerCase().includes(query) ||
      Object.entries(inst.disambiguation).some(
        ([k, v]) => k.toLowerCase().includes(query) || v.toLowerCase().includes(query),
      ) ||
      inst.logs_streams.some((stream) => stream.toLowerCase().includes(query)) ||
      inst.traces_streams.some((stream) => stream.toLowerCase().includes(query)) ||
      inst.metrics_streams.some((stream) => stream.toLowerCase().includes(query));
    groups = groups
      .map((g) => ({ ...g, instances: g.instances.filter(matches) }))
      .filter((g) => g.instances.length > 0);
  }

  const dir = sortOrder.value === "desc" ? -1 : 1;
  return [...groups].sort((a, b) =>
    sortColumn.value === "service_name"
      ? dir * a.name.localeCompare(b.name)
      : dir * ((a.lastSeen || 0) - (b.lastSeen || 0)),
  );
});

const filteredGroupCount = computed(() => visibleGroups.value.length);
// A refresh or filter can leave fewer pages than the one the user was on.
const shownPage = computed(() =>
  Math.min(currentPage.value, Math.max(1, Math.ceil(filteredGroupCount.value / pageSize.value))),
);
const pagedGroups = computed(() =>
  visibleGroups.value.slice(
    (shownPage.value - 1) * pageSize.value,
    shownPage.value * pageSize.value,
  ),
);

// Pages hold whole services. A collapsed service is one summary row, except while a
// search or filter is active, so a match never hides inside a collapsed group.
const flatRows = computed((): any[] => {
  const dir = sortOrder.value === "desc" ? -1 : 1;
  const instDir = sortColumn.value === "last_seen" ? dir : -1;
  const filtersActive = !!searchQuery.value || !!(filterKey.value && filterValue.value);

  return pagedGroups.value.flatMap((g): any[] => {
    if (!filtersActive && collapsedServices.value.has(g.name) && g.instances.length > 1) {
      const logs = new Set<string>();
      const traces = new Set<string>();
      const metrics = new Set<string>();
      for (const inst of g.instances) {
        inst.logs_streams.forEach((s) => logs.add(s));
        inst.traces_streams.forEach((s) => traces.add(s));
        inst.metrics_streams.forEach((s) => metrics.add(s));
      }
      const newest = g.instances.reduce((a, b) => (b.last_seen > a.last_seen ? b : a));
      return [
        {
          id: `service-summary:${g.name}`,
          __type: "summary",
          __group: g.name,
          service_name: newest.service_name,
          display_name: newest.display_name,
          display_source: newest.display_source,
          display_candidates: newest.display_candidates,
          display_qualifier: newest.display_qualifier,
          instanceCount: g.instances.length,
          totalLogs: logs.size,
          totalTraces: traces.size,
          totalMetrics: metrics.size,
          lastSeen: g.lastSeen,
        },
      ];
    }
    // Same-key instances stay adjacent so the name cell merges once per detected key.
    return [...g.instances]
      .sort(
        (a, b) =>
          a.service_name.localeCompare(b.service_name) || instDir * (a.last_seen - b.last_seen),
      )
      .map((inst) => ({
        ...inst,
        lastSeen: inst.last_seen,
        __group: g.name,
        __groupSize: g.instances.length,
      }));
  });
});

// Tile, tab and pager count with one helper over one list, the same count the service card uses.
const serviceCount = computed(() => serviceNameCount(services.value));

const tiles = computed(() => {
  const traced = serviceNameCount(
    services.value.filter((record) => record.traces_streams.length > 0),
  );
  // The no-env bucket is not an environment, so neither the count nor the names include it.
  const envs = (envList.data.value?.envs ?? [])
    .filter((row) => !row.no_env && row.env.trim())
    .map((row) => row.env);
  const versioned = catalog.data.value
    ? new Set(scopes.value.filter((scope) => scope.newest_version).map((scope) => scope.service))
        .size
    : undefined;
  const stripped = catalog.data.value?.stripped_versions ?? 0;
  const envNames = (max: number) =>
    shortList(envs, max, String(locale.value), (count) =>
      t("serviceVersions.discovered.tiles.more", { count }),
    );
  const envsShort = envNames(1);
  return [
    {
      id: "discovered",
      label: t("serviceVersions.discovered.tiles.discovered"),
      value: raw(serviceCount.value),
      sub: t("serviceVersions.discovered.tiles.discoveredSub", { n: traced }),
      full: null,
      linked: false,
    },
    {
      id: "envs",
      label: t("serviceVersions.discovered.tiles.envs"),
      value: raw(envList.data.value?.envs ? envs.length : DASH),
      sub: raw(envsShort),
      full: envs.length > 2 ? raw(envNames(envs.length)) : null,
      linked: false,
    },
    {
      id: "overrides",
      label: t("serviceVersions.discovered.tiles.overrides"),
      value: raw(overrideTotal.data.value?.total ?? DASH),
      sub: null,
      full: null,
      linked: Boolean(overrideTotal.data.value?.total),
    },
    {
      id: "names",
      label: t("serviceVersions.discovered.tiles.names"),
      value: raw(namesTotal.value ?? DASH),
      sub: null,
      full: null,
      linked: Boolean(namesTotal.value),
    },
    {
      id: "versions",
      label: t("serviceVersions.discovered.tiles.versioned"),
      value: raw(versioned ?? DASH),
      sub: stripped
        ? t("serviceVersions.discovered.tiles.versionsStripped", { count: stripped }, stripped)
        : null,
      full: null,
      linked: false,
    },
  ];
});

function setView(value: unknown) {
  const view: DiscoveredView = value === "name-review" ? "name-review" : "services";
  localView.value = view;
  emit("update:view", view);
}

function refreshAll() {
  void loadServices(true);
  if (!identityEnabled.value) return;
  void overrideTotal.refetch();
  void envList.refetch();
  void proposed.refetch();
  void catalog.refetch();
}

function scopeFor(row: ServiceRecord) {
  return scopeForRow(row, scopes.value);
}

function scopeGap(row: ServiceRecord) {
  return row.traces_streams.length
    ? "serviceVersions.discovered.noTracePlace"
    : "serviceVersions.discovered.noTraces";
}

const totalInstances = computed(() =>
  visibleGroups.value.reduce((sum, g) => sum + g.instances.length, 0),
);

// Only the latest read publishes, so a read a reset superseded never brings the deleted rows back.
let loadGeneration = 0;

const loadServices = async (isRefresh = false, afterReset = false) => {
  const generation = ++loadGeneration;
  if (isRefresh) {
    refreshing.value = true;
  } else {
    loading.value = true;
  }
  error.value = null;
  forbidden.value = false;

  try {
    const orgId = store.state.selectedOrganization?.identifier;
    if (!orgId) {
      throw new Error(t("settings.discoveredServices.noOrganizationSelected"));
    }

    // Through the shared query, so the Detection Rules tab mounted beside this one reuses the same read.
    const query = servicesListQuery(orgId);
    // fetchQuery joins a read in flight, and one from before the reset returns the rows it deleted.
    if (afterReset) await queryClient.cancelQueries({ queryKey: query.queryKey });
    const raw = (await queryClient.fetchQuery(
      isRefresh || afterReset ? { ...query, staleTime: 0 } : query,
    )) as ServiceRecord[];
    if (generation !== loadGeneration) return;
    services.value = raw.map((s) => ({
      ...s,
      logs_streams: unique(s.logs_streams),
      traces_streams: unique(s.traces_streams),
      metrics_streams: unique(s.metrics_streams),
    }));
    lastLoadedAt.value = Date.now();
  } catch (err: any) {
    if (generation !== loadGeneration) return;
    console.error("Failed to load services:", err);
    forbidden.value = forbiddenState(err);
    if (!forbidden.value) {
      error.value = err?.message || t("settings.discoveredServices.failedToLoadServices");
    }
  } finally {
    if (generation === loadGeneration) {
      loading.value = false;
      refreshing.value = false;
    }
  }
};

const confirmResetOpen = ref(false);

const confirmResetServices = () => {
  confirmResetOpen.value = true;
};

const doResetServices = async () => {
  resetting.value = true;
  try {
    const orgId = store.state.selectedOrganization?.identifier;
    if (!orgId) {
      throw new Error(t("settings.discoveredServices.noOrganizationSelected"));
    }

    const response = await serviceStreamsService.resetServices(orgId);
    // The reset deletes the rows the cached services list and analytics are built from.
    void queryClient.invalidateQueries({ queryKey: serviceStreamKeys.all(orgId) });
    const { deleted_count } = response.data;

    toast({
      variant: "success",
      message: t("settings.correlation.resetServicesSuccess", {
        count: deleted_count,
      }),
      timeout: 5000,
    });

    await loadServices(false, true);
  } catch (err: any) {
    toast({
      variant: "error",
      message: t("settings.correlation.resetServicesFailed"),
    });
  } finally {
    resetting.value = false;
  }
};

onMounted(() => {
  loadServices();
});
</script>
