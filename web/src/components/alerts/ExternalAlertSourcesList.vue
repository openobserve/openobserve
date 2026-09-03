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
  <OPageLayout
    :title="t('alert_sources.header')"
    :subtitle="t('alert_sources.subtitle')"
    title-data-test="alert-sources-list-title"
    icon="webhook"
    bleed
  >
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        icon-left="add"
        data-test="alert-sources-add-btn"
        @click="openAddDrawer"
      >
        {{ t("alert_sources.add") }}
      </OButton>
    </template>

    <AddExternalAlertSource
      v-model:open="showAddDrawer"
      :editing-integration="editTargetIntegration"
      @created="fetchAll(true)"
      @updated="fetchAll(true)"
    />

    <div class="min-h-0 w-full flex-1 overflow-hidden">
      <div class="bg-card-glass-bg h-full">
        <OTable
          :frame="false"
          :data="visibleRows"
          :columns="advancedColumns"
          row-key="rowKey"
          :loading="loading"
          pagination="client"
          :page-size="20"
          :page-size-options="[10, 20, 50, 100]"
          :row-class="noDestinationRowClass"
          :footer-title="t('alert_sources.header')"
          wrap
          horizontal-scroll
          :default-columns="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="alerts-external-sources"
          :show-global-filter="false"
          data-test="alert-sources-advanced-table"
        >
          <template #toolbar>
            <OSearchInput
              v-model="filterQuery"
              class="flex-1"
              :placeholder="t('alert_sources.searchPlaceholder')"
              data-test="alert-sources-search-input"
            />
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="fetching"
              data-test="alert-sources-refresh-btn"
              @click="refreshAll"
            >
              <OTooltip
                side="bottom"
                :content="t('alert_sources.refresh')"
                shortcut-id="alertSourcesRefresh"
              />
            </OButton>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-alert-sources"
              :filtered="!!filterQuery"
              data-test="alert-sources-empty-state"
              @action="onEmptyAction"
            />
          </template>
          <template #cell-name="{ row }">
            <div class="flex min-w-0 flex-col">
              <div class="flex min-w-0 items-center gap-2">
                <span class="min-w-0 truncate font-medium" :title="row.displayName">{{
                  row.displayName
                }}</span>
              </div>
              <span v-if="row.nameCaption" class="text-text-secondary truncate text-xs">{{
                row.nameCaption
              }}</span>
            </div>
          </template>
          <template #cell-status="{ row }">
            <div class="flex items-center gap-1">
              <OTag v-if="row.status === 'receiving'" variant="success-soft" dot>
                {{ t("alert_sources.statusReceiving") }}
              </OTag>
              <OTag v-else-if="row.status === 'stale'" variant="warning-soft" dot>
                {{ t("alert_sources.statusStale") }}
              </OTag>
              <OTag
                v-else-if="row.resolveWiringHint"
                variant="warning-soft"
                dot
                data-test="alert-sources-never-resolves-tag"
              >
                {{ t("alert_sources.statusNeverResolves") }}
              </OTag>
              <OTag v-else variant="default-outline">
                {{ t("alert_sources.statusNotConnected") }}
              </OTag>
              <!-- The hint can co-occur with Receiving/Stale, so it also needs
                   a standalone icon beside the status tag. -->
              <OIcon
                v-if="row.resolveWiringHint && row.status !== 'not_connected'"
                name="flag"
                size="xs"
                class="text-status-warning-text"
                data-test="alert-sources-never-resolves-icon"
              >
                <OTooltip :delay="300" :max-width="'20rem'">
                  <template #content>
                    <span class="font-medium">
                      {{ t("alert_sources.resolveWiringWarningTitle", { name: row.displayName }) }}
                    </span>
                    {{ t("alert_sources.resolveWiringWarningBody") }}
                  </template>
                </OTooltip>
              </OIcon>
            </div>
          </template>
          <template #cell-destination="{ row }">
            <span v-if="row.destinations.length > 0" class="text-text-secondary text-xs">
              {{ row.destinations.join(", ") }}
            </span>
            <OTag
              v-else-if="row.integration"
              variant="error-soft"
              dot
              data-test="alert-sources-no-destination-tag"
            >
              {{ t("alert_sources.noDestinationSet") }}
            </OTag>
            <span v-else class="text-text-secondary">—</span>
          </template>
          <template #cell-last_event="{ row }">
            <span class="text-text-secondary text-xs">{{ row.lastEventLabel }}</span>
          </template>
          <template #cell-url="{ row }">
            <div v-if="row.integration" class="flex items-center gap-1">
              <OButton
                variant="ghost"
                size="icon-xs-sq"
                :icon-left="isRevealed(row.integration) ? 'visibility-off' : 'visibility'"
                :title="
                  isRevealed(row.integration)
                    ? t('alert_sources.hideToken')
                    : t('alert_sources.revealToken')
                "
                :data-test="`alert-sources-reveal-${row.integration.id}`"
                @click="toggleRevealFor(row.integration)"
              />
              <OButton
                variant="ghost"
                size="icon-xs-sq"
                icon-left="content-copy"
                :title="t('alert_sources.copyUrl')"
                :data-test="`alert-sources-copy-${row.integration.id}`"
                @click="copyUrlFor(row.integration)"
              />
              <OButton
                variant="ghost"
                size="icon-xs-sq"
                icon-left="key"
                :title="t('alert_sources.copyToken')"
                :data-test="`alert-sources-copy-token-${row.integration.id}`"
                @click="copyTokenFor(row.integration)"
              />
              <span class="truncate font-mono text-xs" :title="displayedUrlFor(row.integration)">{{
                displayedUrlFor(row.integration)
              }}</span>
            </div>
            <span v-else class="text-text-secondary">—</span>
          </template>
          <template #cell-actions="{ row }">
            <div v-if="row.integration" class="flex items-center gap-1">
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="edit"
                :title="t('alert_sources.edit')"
                :data-test="`alert-sources-edit-${row.integration.id}`"
                @click="openEditFor(row.integration)"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="autorenew"
                :title="t('alert_sources.rotateToken')"
                :data-test="`alert-sources-rotate-${row.integration.id}`"
                @click="confirmRotate(row.integration)"
              />
              <OButton
                :variant="row.integration.enabled ? 'ghost-destructive' : 'ghost-success'"
                size="icon-sm"
                :icon-left="row.integration.enabled ? 'pause' : 'play-arrow'"
                :title="
                  row.integration.enabled ? t('alert_sources.disable') : t('alert_sources.enable')
                "
                :data-test="`alert-sources-toggle-enabled-${row.integration.id}`"
                @click="toggleEnabledFor(row.integration)"
              />
              <OButton
                variant="ghost-destructive"
                size="icon-sm"
                icon-left="delete"
                :disabled="row.integration.name === 'default'"
                :title="
                  row.integration.name === 'default'
                    ? t('alert_sources.defaultCannotDelete')
                    : t('alert_sources.delete')
                "
                :data-test="`alert-sources-delete-${row.integration.id}`"
                @click="confirmDelete(row.integration)"
              />
            </div>
            <span
              v-else
              class="text-text-secondary text-xs"
              :title="t('alert_sources.sharedTokenActionsHint')"
            >
              —
            </span>
          </template>
        </OTable>
      </div>
    </div>

    <ConfirmDialog
      v-model="rotateDialogVisible"
      :title="t('alert_sources.rotateConfirmTitle')"
      :message="t('alert_sources.rotateConfirmMessage')"
      :warning-message="t('alert_sources.rotateConfirmWarning')"
      :ok-label="t('alert_sources.rotateToken')"
      ok-color="destructive"
      data-test="alert-sources-rotate-dialog"
      @update:ok="doRotate"
    />

    <ConfirmDialog
      v-model="deleteDialogVisible"
      :title="t('alert_sources.deleteConfirmTitle')"
      :message="t('alert_sources.deleteConfirmMessage')"
      :warning-message="t('alert_sources.deleteConfirmWarning')"
      :ok-label="t('alert_sources.delete')"
      ok-color="destructive"
      data-test="alert-sources-delete-dialog"
      @update:ok="doDelete"
    />
  </OPageLayout>
</template>

<script lang="ts">
import { alertSourcesQuery } from "@/services/alert_sources.queries";
import { queryClient } from "@/composables/query/queryClient";
import { defineComponent, getCurrentInstance } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AddExternalAlertSource from "./AddExternalAlertSource.vue";
import alertSources from "@/services/alert_sources";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import { getAlertSourceStatus } from "@/utils/alertSourceStatus";
import { formatTimeAgoUs } from "@/utils/synthetics/format";
import { copyToClipboard } from "@/utils/clipboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import { COL } from "@/lib/core/Table/OTable.types";
import type { AlertSourceIntegration } from "@/ts/interfaces/alertSources";

interface SourceStatusRow {
  displayName: string;
  status: "receiving" | "stale" | "not_connected";
  acceptedCount: number;
  rejectedCount: number;
  resolveWiringHint: boolean;
  lastReceivedAt: number;
}

/** A table row: an additional integration, or a sender under the default
 *  source (those share the default's URL/token, so `integration` is unset). */
interface SourceTableRow {
  rowKey: string;
  displayName: string;
  nameCaption: string;
  status: "receiving" | "stale" | "not_connected";
  integration: AlertSourceIntegration | undefined;
  sharesDefaultToken: boolean;
  destinations: string[];
  resolveWiringHint: boolean;
  lastEventLabel: string;
}

export default defineComponent({
  name: "ExternalAlertSourcesList",
  components: {
    OPageLayout,
    OButton,
    OTag,
    OTable,
    OIcon,
    OSearchInput,
    OEmptyState,
    OTooltip,
    ConfirmDialog,
    AddExternalAlertSource,
  },
  setup() {
    const store = useStore();
    const { t } = useI18nTyped();

    // useShortcuts must run in setup(); the proxy reaches this Options-API
    // component's own methods.
    const instance = getCurrentInstance();
    const vm = () => instance?.proxy as any;
    useShortcuts([
      {
        id: "alertSourcesAdd",
        handler: () => {
          if (!isInputFocused()) vm()?.openAddDrawer();
        },
      },
      {
        id: "alertSourcesRefresh",
        handler: () => {
          if (!isInputFocused()) vm()?.refreshAll();
        },
      },
      {
        id: "alertSourcesFocusSearch",
        handler: () => focusSearchInput("alert-sources-search-input"),
      },
    ]);

    return { store, t, raw };
  },
  data() {
    return {
      loading: false,
      // Request in flight with rows still on screen — the refresh button's
      // spinner. `loading` is the skeleton, for a cold read only.
      fetching: false,
      filterQuery: "",
      showAddDrawer: false,
      editTargetIntegration: undefined as AlertSourceIntegration | undefined,
      integrations: [] as AlertSourceIntegration[],
      sourceStatuses: [] as SourceStatusRow[],
      revealedIds: [] as string[],
      rotateDialogVisible: false,
      rotateTarget: undefined as AlertSourceIntegration | undefined,
      deleteDialogVisible: false,
      deleteTarget: undefined as AlertSourceIntegration | undefined,
      additionalStatusById: {} as Record<string, "receiving" | "stale" | "not_connected">,
      additionalResolveWiringHintById: {} as Record<string, boolean>,
      additionalLastReceivedAtById: {} as Record<string, number | undefined>,
      // default-columns=false (table-fixed) is what keeps `wrap`ped text inside
      // its own column instead of bleeding into the next one.
      advancedColumns: [
        {
          id: "name",
          header: this.t("alert_sources.name"),
          accessorKey: "displayName",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.name,
          minSize: 160,
          // `flex`, not `autoWidth`: both absorb leftover width, but autoWidth
          // columns are never resizable (no Name│Status drag handle).
          meta: { align: "left", flex: true },
        },
        {
          id: "status",
          header: this.t("alert_sources.statusColumnHeader"),
          accessorKey: "rowKey",
          resizable: true,
          hideable: true,
          size: 150,
          meta: { align: "left" },
        },
        {
          id: "destination",
          header: this.t("alert_sources.incidentDestination"),
          accessorKey: "rowKey",
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "left" },
        },
        {
          id: "last_event",
          header: this.t("alert_sources.lastEvent"),
          accessorKey: "rowKey",
          resizable: true,
          hideable: true,
          size: 100,
          meta: { align: "left" },
        },
        {
          id: "url",
          header: this.t("alert_sources.urlHeader"),
          accessorKey: "rowKey",
          resizable: true,
          hideable: true,
          size: 420,
          minSize: 420,
          meta: { align: "left" },
        },
        {
          id: "actions",
          header: this.t("alert_sources.actions"),
          isAction: true,
          pinned: "right",
          size: 150,
          meta: { align: "center", actionCount: 4 },
        },
      ] as any[],
    };
  },
  computed: {
    orgIdentifier(): string {
      return this.store.state.selectedOrganization.identifier;
    },
    defaultSource(): AlertSourceIntegration | undefined {
      return this.integrations.find((i) => i.name === "default");
    },
    additionalIntegrations(): AlertSourceIntegration[] {
      return this.integrations.filter((i) => i.name !== "default");
    },
    ingestionBaseUrl(): string {
      const ingestionURL = getIngestionURL();
      return getEndPoint(ingestionURL).url;
    },
    tableRows(): SourceTableRow[] {
      const rows: SourceTableRow[] = [];

      if (this.defaultSource) {
        if (this.sourceStatuses.length === 0) {
          rows.push({
            rowKey: `default:${this.defaultSource.id}`,
            displayName: this.defaultSource.name,
            nameCaption: this.t("alert_sources.acceptsAnyFormat"),
            status: "not_connected",
            integration: this.defaultSource,
            sharesDefaultToken: false,
            destinations: this.defaultSource.destinations,
            resolveWiringHint: false,
            lastEventLabel: "—",
          });
        } else {
          this.sourceStatuses.forEach((s, idx) => {
            rows.push({
              rowKey: `default:${this.defaultSource!.id}:${s.displayName}`,
              displayName: s.displayName,
              nameCaption: "",
              status: s.status,
              // Only the first sender row carries the shared URL/token actions.
              integration: idx === 0 ? this.defaultSource : undefined,
              sharesDefaultToken: true,
              destinations: this.defaultSource!.destinations,
              resolveWiringHint: s.resolveWiringHint,
              lastEventLabel: formatTimeAgoUs(s.lastReceivedAt),
            });
          });
        }
      }

      for (const integration of this.additionalIntegrations) {
        const lastReceivedAt = this.additionalLastReceivedAtById[integration.id];
        rows.push({
          rowKey: `additional:${integration.id}`,
          displayName: integration.name,
          nameCaption: "",
          status: this.additionalStatusById[integration.id] ?? "not_connected",
          integration,
          sharesDefaultToken: false,
          destinations: integration.destinations,
          resolveWiringHint: this.additionalResolveWiringHintById[integration.id] ?? false,
          lastEventLabel: lastReceivedAt ? formatTimeAgoUs(lastReceivedAt) : "—",
        });
      }

      return rows;
    },
    // Client-side search — the list is fetched whole anyway.
    visibleRows(): SourceTableRow[] {
      const term = this.filterQuery.trim().toLowerCase();
      if (!term) return this.tableRows;
      return this.tableRows.filter(
        (row) =>
          row.displayName.toLowerCase().includes(term) ||
          row.destinations.some((d) => d.toLowerCase().includes(term)),
      );
    },
  },
  mounted() {
    this.fetchAll();
  },
  methods: {
    // Named handler: binding fetchAll straight to @click puts the MouseEvent in
    // `force`.
    refreshAll() {
      return this.fetchAll(true);
    },
    async fetchAll(force = false) {
      await this.fetchIntegrations(force);
      const fetches: Promise<void>[] = [];
      if (this.defaultSource) {
        fetches.push(this.fetchSenders(this.defaultSource.id));
      }
      for (const integration of this.additionalIntegrations) {
        fetches.push(this.fetchAdditionalStatus(integration.id));
      }
      await Promise.all(fetches);
    },
    async fetchIntegrations(force = false) {
      try {
        // `force` only bypasses staleTime — the rows on screen stay either way,
        // and the skeleton is reserved for a genuinely cold read.
        const options = alertSourcesQuery(this.orgIdentifier);
        // Paint what is already cached before the request goes out.
        const cached = queryClient.getQueryData<any>(options.queryKey);
        if (cached !== undefined) this.integrations = cached;
        this.loading = cached === undefined;
        this.fetching = true;
        // Options API, so this reads imperatively rather than through useQuery.
        // TODO: move to `useQuery` when this component moves to `setup()`.
        if (force) {
          await queryClient.invalidateQueries({
            queryKey: options.queryKey,
            exact: true,
            refetchType: "none",
          });
        }
        this.integrations = await queryClient.fetchQuery(options);
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.error") });
      } finally {
        this.loading = false;
        this.fetching = false;
      }
    },
    async fetchSenders(integrationId: string) {
      try {
        const res = await alertSources.listSenders(this.orgIdentifier, integrationId);
        const now = Date.now() * 1000;
        this.sourceStatuses = res.data.senders.map((s: any) => ({
          displayName: s.display_name,
          status: getAlertSourceStatus(s.last_received_at, now),
          acceptedCount: s.accepted_count,
          rejectedCount: s.rejected_count,
          resolveWiringHint: s.resolve_wiring_hint,
          lastReceivedAt: s.last_received_at,
        }));
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.senderError") });
      }
    },
    async fetchAdditionalStatus(integrationId: string) {
      try {
        const res = await alertSources.listSenders(this.orgIdentifier, integrationId);
        const now = Date.now() * 1000;
        const senders = res.data.senders as Array<{
          last_received_at: number;
          resolve_wiring_hint: boolean;
        }>;
        const statuses = senders.map((s) => getAlertSourceStatus(s.last_received_at, now));
        if (statuses.length === 0) {
          this.additionalStatusById = {
            ...this.additionalStatusById,
            [integrationId]: "not_connected",
          };
        } else if (statuses.includes("receiving")) {
          this.additionalStatusById = {
            ...this.additionalStatusById,
            [integrationId]: "receiving",
          };
        } else {
          this.additionalStatusById = { ...this.additionalStatusById, [integrationId]: "stale" };
        }
        this.additionalResolveWiringHintById = {
          ...this.additionalResolveWiringHintById,
          [integrationId]: senders.some((s) => s.resolve_wiring_hint),
        };
        this.additionalLastReceivedAtById = {
          ...this.additionalLastReceivedAtById,
          [integrationId]:
            senders.length > 0 ? Math.max(...senders.map((s) => s.last_received_at)) : undefined,
        };
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.senderError") });
      }
    },
    isRevealed(integration: AlertSourceIntegration): boolean {
      return this.revealedIds.includes(integration.id);
    },
    toggleRevealFor(integration: AlertSourceIntegration) {
      const idx = this.revealedIds.indexOf(integration.id);
      if (idx === -1) {
        this.revealedIds.push(integration.id);
      } else {
        this.revealedIds.splice(idx, 1);
      }
    },
    copyUrlFor(integration: AlertSourceIntegration) {
      copyToClipboard(this.fullUrlFor(integration), this.t);
    },
    copyTokenFor(integration: AlertSourceIntegration) {
      copyToClipboard(integration.token, this.t);
    },
    fullUrlFor(integration: AlertSourceIntegration): string {
      return `${this.ingestionBaseUrl}${integration.url}`;
    },
    displayedUrlFor(integration: AlertSourceIntegration): string {
      const full = this.fullUrlFor(integration);
      if (this.isRevealed(integration)) return full;
      const token = integration.token;
      const masked = `${token.slice(0, 6)}****${token.slice(-4)}`;
      return full.replace(token, masked);
    },
    confirmRotate(integration: AlertSourceIntegration) {
      this.rotateTarget = integration;
      this.rotateDialogVisible = true;
    },
    async doRotate() {
      if (!this.rotateTarget) return;
      try {
        await alertSources.rotate(this.orgIdentifier, this.rotateTarget.id);
        toast({ variant: "success", message: this.t("alert_sources.rotatedSuccess") });
        this.revealedIds = this.revealedIds.filter((id) => id !== this.rotateTarget?.id);
        this.rotateTarget = undefined;
        await this.fetchAll();
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.error") });
      }
    },
    confirmDelete(integration: AlertSourceIntegration) {
      this.deleteTarget = integration;
      this.deleteDialogVisible = true;
    },
    async doDelete() {
      if (!this.deleteTarget) return;
      try {
        await alertSources.delete(this.orgIdentifier, this.deleteTarget.id);
        toast({ variant: "success", message: this.t("alert_sources.deletedSuccess") });
        this.revealedIds = this.revealedIds.filter((id) => id !== this.deleteTarget?.id);
        this.deleteTarget = undefined;
        await this.fetchAll(true);
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.error") });
      }
    },
    async toggleEnabledFor(row: AlertSourceIntegration) {
      try {
        await alertSources.setEnabled(this.orgIdentifier, row.id, !row.enabled);
        toast({
          variant: "success",
          message: row.enabled
            ? this.t("alert_sources.disabledSuccess")
            : this.t("alert_sources.enabledSuccess"),
        });
        await this.fetchIntegrations(true);
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.error") });
      }
    },
    openAddDrawer() {
      this.editTargetIntegration = undefined;
      this.showAddDrawer = true;
    },
    openEditFor(integration: AlertSourceIntegration) {
      this.editTargetIntegration = integration;
      this.showAddDrawer = true;
    },
    // Tints rows that have no incident destination configured.
    noDestinationRowClass(row: SourceTableRow): string {
      return row.integration && row.destinations.length === 0 ? "bg-banner-error-soft-bg" : "";
    },
    // `id` is optional: OEmptyState's simple-button mode emits no id.
    onEmptyAction(id?: string) {
      if (id === "clear-filters") {
        this.filterQuery = "";
        return;
      }
      this.openAddDrawer();
    },
  },
});
</script>
