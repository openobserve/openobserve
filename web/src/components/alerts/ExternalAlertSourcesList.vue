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
    scroll
    pad-y
  >
    <template #actions>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="loading"
        data-test="alert-sources-refresh-btn"
        @click="fetchAll"
      />
    </template>

    <div v-if="defaultSource" class="flex flex-col gap-6 text-sm">
      <!-- Webhook URL -->
      <div class="flex flex-col gap-2">
        <div class="font-semibold">{{ t("alert_sources.webhookUrlLabel") }}</div>
        <p class="text-text-secondary">{{ t("alert_sources.webhookUrlHelp") }}</p>
        <CopyContent
          :key="isRevealed(defaultSource) ? 'revealed' : 'masked'"
          :content="fullUrlFor(defaultSource)"
          :display-content="displayedUrlFor(defaultSource)"
          data-test="alert-sources-url-cell"
        />
      </div>

      <!-- Alerting tool + setup -->
      <div class="flex flex-col gap-2">
        <div class="font-semibold">{{ t("alert_sources.sourceTypeLabel") }}</div>
        <OTabs v-model="selectedSetupType" dense data-test="alert-sources-setup-type-tabs">
          <OTab
            name="grafana"
            :label="t('alert_sources.sourceTypes.grafana')"
            data-test="alert-sources-setup-type-grafana"
          />
          <OTab
            name="alertmanager"
            :label="t('alert_sources.sourceTypes.alertmanager')"
            data-test="alert-sources-setup-type-alertmanager"
          />
          <OTab
            name="generic"
            :label="t('alert_sources.sourceTypes.generic')"
            data-test="alert-sources-setup-type-generic"
          />
        </OTabs>
        <p class="text-text-secondary">
          {{ t(`alert_sources.setup.${selectedSetupType}Steps`) }}
        </p>
        <CopyContent v-if="selectedSetupType === 'alertmanager'" :content="alertmanagerSnippet" />
        <CopyContent v-else-if="selectedSetupType === 'generic'" :content="genericSnippet" />
      </div>

      <!-- Alert sources table -->
      <div class="mt-2 flex flex-col gap-3 text-sm">
        <div class="flex items-center justify-between">
          <div class="font-semibold">{{ t("alert_sources.statusHeader") }}</div>
          <OButton
            v-if="!showAddEditor"
            variant="primary"
            size="sm"
            icon-left="add"
            data-test="alert-sources-add-btn"
            @click="showAddEditor = true"
          >
            {{ t("alert_sources.add") }}
          </OButton>
        </div>
        <AddExternalAlertSource
          v-if="showAddEditor"
          @created="fetchIntegrations"
          @cancel:hideform="showAddEditor = false"
        />
        <OTable
          :data="tableRows"
          :columns="advancedColumns"
          row-key="rowKey"
          pagination="client"
          :page-size="10"
          data-test="alert-sources-advanced-table"
        >
          <template #cell-name="{ row }">
            <div class="flex items-center gap-2">
              <span>{{ row.displayName }}</span>
              <OTag
                v-if="row.sharesDefaultToken"
                variant="default-outline"
                :title="t('alert_sources.sharedTokenHint')"
                data-test="alert-sources-shared-token-badge"
              >
                {{ t("alert_sources.sharedTokenBadge") }}
              </OTag>
            </div>
          </template>
          <template #cell-status="{ row }">
            <OTag v-if="row.status === 'receiving'" variant="success-soft" dot>
              {{ t("alert_sources.statusReceiving") }}
            </OTag>
            <OTag v-else-if="row.status === 'stale'" variant="warning-soft" dot>
              {{ t("alert_sources.statusStale") }}
            </OTag>
            <OTag v-else variant="default-outline">
              {{ t("alert_sources.statusNotConnected") }}
            </OTag>
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
              <span class="truncate font-mono text-xs">{{ displayedUrlFor(row.integration) }}</span>
            </div>
            <span v-else class="text-text-secondary">—</span>
          </template>
          <template #cell-actions="{ row }">
            <div v-if="row.integration" class="flex items-center gap-1">
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
                v-if="row.integration.name !== 'default'"
                variant="ghost-destructive"
                size="icon-sm"
                icon-left="delete"
                :title="t('alert_sources.delete')"
                :data-test="`alert-sources-delete-${row.integration.id}`"
                @click="confirmDelete(row.integration)"
              />
            </div>
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
import { defineComponent } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import CopyContent from "@/components/CopyContent.vue";
import AddExternalAlertSource from "./AddExternalAlertSource.vue";
import alertSources from "@/services/alert_sources";
import { getAlertSourceStatus } from "@/utils/alertSourceStatus";
import { copyToClipboard } from "@/utils/clipboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import type { AlertSourceIntegration } from "@/ts/interfaces/alertSources";

interface SourceStatusRow {
  displayName: string;
  status: "receiving" | "stale" | "not_connected";
  acceptedCount: number;
  rejectedCount: number;
  resolveWiringHint: boolean;
}

export default defineComponent({
  name: "ExternalAlertSourcesList",
  components: {
    OPageLayout,
    OButton,
    OTag,
    OTable,
    OTabs,
    OTab,
    ConfirmDialog,
    CopyContent,
    AddExternalAlertSource,
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    return { store, t };
  },
  data() {
    return {
      loading: false,
      integrations: [] as AlertSourceIntegration[],
      sourceStatuses: [] as SourceStatusRow[],
      revealedIds: [] as string[],
      rotateDialogVisible: false,
      rotateTarget: undefined as AlertSourceIntegration | undefined,
      deleteDialogVisible: false,
      deleteTarget: undefined as AlertSourceIntegration | undefined,
      showAddEditor: false,
      selectedSetupType: "grafana" as "grafana" | "alertmanager" | "generic",
      additionalStatusById: {} as Record<string, "receiving" | "stale" | "not_connected">,
      advancedColumns: [
        {
          id: "name",
          header: this.t("alert_sources.name"),
          accessorKey: "displayName",
          sortable: true,
        },
        {
          id: "source_type",
          header: this.t("alert_sources.sourceType"),
          accessorKey: "sourceType",
        },
        { id: "status", header: this.t("alert_sources.statusColumnHeader"), accessorKey: "rowKey" },
        { id: "url", header: this.t("alert_sources.urlHeader"), accessorKey: "rowKey" },
        { id: "actions", header: this.t("alert_sources.actions"), isAction: true, size: 100 },
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
    fullUrl(): string {
      if (!this.defaultSource) return "";
      return this.fullUrlFor(this.defaultSource);
    },
    tableRows(): Array<{
      rowKey: string;
      displayName: string;
      sourceType: string;
      status: "receiving" | "stale" | "not_connected";
      integration: AlertSourceIntegration | undefined;
      sharesDefaultToken: boolean;
    }> {
      const rows: Array<{
        rowKey: string;
        displayName: string;
        sourceType: string;
        status: "receiving" | "stale" | "not_connected";
        integration: AlertSourceIntegration | undefined;
        sharesDefaultToken: boolean;
      }> = [];

      if (this.defaultSource) {
        if (this.sourceStatuses.length === 0) {
          rows.push({
            rowKey: `default:${this.defaultSource.id}`,
            displayName: this.defaultSource.name,
            sourceType: this.defaultSource.source_type,
            status: "not_connected",
            integration: this.defaultSource,
            sharesDefaultToken: false,
          });
        } else {
          this.sourceStatuses.forEach((s, idx) => {
            rows.push({
              rowKey: `default:${this.defaultSource!.id}:${s.displayName}`,
              displayName: s.displayName,
              sourceType: this.defaultSource!.source_type,
              status: s.status,
              // Only the first sender row carries the shared URL/token controls
              // to avoid repeating identical actions per sender.
              integration: idx === 0 ? this.defaultSource : undefined,
              sharesDefaultToken: true,
            });
          });
        }
      }

      for (const integration of this.additionalIntegrations) {
        rows.push({
          rowKey: `additional:${integration.id}`,
          displayName: integration.name,
          sourceType: integration.source_type,
          status: this.additionalStatusById[integration.id] ?? "not_connected",
          integration,
          sharesDefaultToken: false,
        });
      }

      return rows;
    },
    alertmanagerSnippet(): string {
      return [
        "receivers:",
        "  - name: openobserve-incidents",
        "    webhook_configs:",
        `      - url: "${this.fullUrl}"`,
        "        send_resolved: true",
      ].join("\n");
    },
    genericSnippet(): string {
      return [
        `curl -X POST '${this.fullUrl}' -H 'Content-Type: application/json' \\`,
        `  -d '{"status":"firing","labels":{"alertname":"HighCPU","service":"checkout"}}'`,
      ].join("\n");
    },
  },
  mounted() {
    this.fetchAll();
  },
  methods: {
    async fetchAll() {
      await this.fetchIntegrations();
      const fetches: Promise<void>[] = [];
      if (this.defaultSource) {
        fetches.push(this.fetchSenders(this.defaultSource.id));
      }
      for (const integration of this.additionalIntegrations) {
        fetches.push(this.fetchAdditionalStatus(integration.id));
      }
      await Promise.all(fetches);
    },
    async fetchIntegrations() {
      this.loading = true;
      try {
        const res = await alertSources.list(this.orgIdentifier);
        this.integrations = res.data.integrations;
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.error") });
      } finally {
        this.loading = false;
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
        }));
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.senderError") });
      }
    },
    async fetchAdditionalStatus(integrationId: string) {
      try {
        const res = await alertSources.listSenders(this.orgIdentifier, integrationId);
        const now = Date.now() * 1000;
        const statuses = res.data.senders.map((s: any) =>
          getAlertSourceStatus(s.last_received_at, now),
        );
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
      copyToClipboard(this.fullUrlFor(integration));
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
        await this.fetchAll();
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
        await this.fetchIntegrations();
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.error") });
      }
    },
  },
});
</script>
