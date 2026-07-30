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
    constrained
    content-size="md"
    :title="t('alert_sources.header')"
    :subtitle="t('alert_sources.subtitle')"
    title-data-test="alert-sources-list-title"
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

    <div
      v-if="defaultSource"
      class="q-pa-md"
      style="border: 1px solid var(--border-default); border-radius: 8px"
    >
      <div class="row items-center justify-between q-mb-sm">
        <div class="text-subtitle1">{{ t("alert_sources.webhookUrlLabel") }}</div>
        <div class="row items-center">
          <OButton
            variant="ghost"
            size="icon-sm"
            :icon-left="revealed ? 'visibility-off' : 'visibility'"
            data-test="alert-sources-reveal-btn"
            @click="toggleReveal"
          />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="content-copy"
            data-test="alert-sources-copy-btn"
            @click="copyUrl"
          />
        </div>
      </div>
      <OCodeCell :value="displayedUrl" :copy="false" data-test="alert-sources-url-cell" />

      <div class="row items-center q-mt-md" style="gap: 8px">
        <OButton
          variant="outline-destructive"
          size="sm"
          icon-left="autorenew"
          data-test="alert-sources-rotate-btn"
          @click="confirmRotate"
        >
          {{ t("alert_sources.rotateToken") }}
        </OButton>
        <OButton
          :variant="defaultSource.enabled ? 'ghost-destructive' : 'ghost-success'"
          size="sm"
          :icon-left="defaultSource.enabled ? 'pause' : 'play-arrow'"
          data-test="alert-sources-toggle-enabled-btn"
          @click="toggleEnabled"
        >
          {{ defaultSource.enabled ? t("alert_sources.disable") : t("alert_sources.enable") }}
        </OButton>
      </div>

      <div class="q-mt-lg">
        <div class="text-subtitle2 q-mb-sm">{{ t("alert_sources.statusHeader") }}</div>
        <OEmptyState
          v-if="sourceStatuses.length === 0"
          size="inline"
          :title="t('alert_sources.statusNotConnected')"
        />
        <div v-for="status in sourceStatuses" :key="status.detectedSource" class="q-mb-sm">
          <div class="row items-center" style="gap: 8px">
            <span class="text-body2">{{ status.detectedSource }}</span>
            <OTag v-if="status.status === 'receiving'" variant="success-soft" dot>
              {{ t("alert_sources.statusReceiving") }}
            </OTag>
            <OTag v-else-if="status.status === 'stale'" variant="warning-soft" dot>
              {{ t("alert_sources.statusStale") }}
            </OTag>
            <OTag v-else variant="default-outline">
              {{ t("alert_sources.statusNotConnected") }}
            </OTag>
            <span class="text-caption text-grey-7">
              {{ t("alert_sources.acceptedCount") }}: {{ status.acceptedCount }},
              {{ t("alert_sources.rejectedCount") }}: {{ status.rejectedCount }}
            </span>
          </div>
          <div v-if="status.resolveWiringHint" class="text-caption text-warning q-mt-xs">
            {{ t("alert_sources.resolveHintMessage") }}
          </div>
        </div>
      </div>
    </div>

    <div class="q-mt-lg">
      <OButton
        variant="ghost"
        size="sm"
        :icon-left="showAdvanced ? 'expand-less' : 'expand-more'"
        data-test="alert-sources-advanced-toggle"
        @click="showAdvanced = !showAdvanced"
      >
        {{ t("alert_sources.advancedSectionTitle") }}
      </OButton>
      <div v-if="showAdvanced" class="q-mt-sm">
        <p class="text-caption text-grey-7">{{ t("alert_sources.advancedSectionDesc") }}</p>
        <div v-if="!showAddEditor">
          <div class="row justify-end q-mb-sm">
            <OButton
              variant="primary"
              size="sm"
              icon-left="add"
              data-test="alert-sources-add-btn"
              @click="showAddEditor = true"
            >
              {{ t("alert_sources.add") }}
            </OButton>
          </div>
          <OTable
            :data="additionalIntegrations"
            :columns="advancedColumns"
            row-key="id"
            pagination="client"
            :page-size="10"
            data-test="alert-sources-advanced-table"
          >
            <template #cell-actions="{ row }">
              <OButton
                :variant="row.enabled ? 'ghost-destructive' : 'ghost-success'"
                size="icon-sm"
                :icon-left="row.enabled ? 'pause' : 'play-arrow'"
                @click="toggleEnabledFor(row)"
              />
            </template>
          </OTable>
        </div>
        <AddExternalAlertSource
          v-else
          @created="fetchIntegrations"
          @cancel:hideform="showAddEditor = false"
        />
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
  </OPageLayout>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OCodeCell from "@/lib/core/Table/cells/OCodeCell.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AddExternalAlertSource from "./AddExternalAlertSource.vue";
import alertSources from "@/services/alert_sources";
import { getAlertSourceStatus } from "@/utils/alertSourceStatus";
import { copyToClipboard } from "@/utils/clipboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { AlertSourceIntegration } from "@/ts/interfaces/alertSources";

interface SourceStatusRow {
  detectedSource: string;
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
    OEmptyState,
    OCodeCell,
    OTable,
    ConfirmDialog,
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
      revealed: false,
      rotateDialogVisible: false,
      showAdvanced: false,
      showAddEditor: false,
      advancedColumns: [
        { id: "name", header: this.t("alert_sources.name"), accessorKey: "name", sortable: true },
        { id: "source_type", header: this.t("alert_sources.sourceType"), accessorKey: "source_type" },
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
    displayedUrl(): string {
      if (!this.defaultSource) return "";
      if (this.revealed) return this.defaultSource.url;
      const token = this.defaultSource.token;
      const masked = `${token.slice(0, 6)}****${token.slice(-4)}`;
      return this.defaultSource.url.replace(token, masked);
    },
  },
  mounted() {
    this.fetchAll();
  },
  methods: {
    async fetchAll() {
      await this.fetchIntegrations();
      if (this.defaultSource) {
        await this.fetchSenders(this.defaultSource.id);
      }
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
          detectedSource: s.detected_source,
          status: getAlertSourceStatus(s.last_received_at, now),
          acceptedCount: s.accepted_count,
          rejectedCount: s.rejected_count,
          resolveWiringHint: s.resolve_wiring_hint,
        }));
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.senderError") });
      }
    },
    toggleReveal() {
      this.revealed = !this.revealed;
    },
    copyUrl() {
      if (!this.defaultSource) return;
      copyToClipboard(this.defaultSource.url);
    },
    confirmRotate() {
      this.rotateDialogVisible = true;
    },
    async doRotate() {
      if (!this.defaultSource) return;
      try {
        await alertSources.rotate(this.orgIdentifier, this.defaultSource.id);
        toast({ variant: "success", message: this.t("alert_sources.rotatedSuccess") });
        this.revealed = false;
        await this.fetchAll();
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.error") });
      }
    },
    async toggleEnabled() {
      if (!this.defaultSource) return;
      try {
        await alertSources.setEnabled(
          this.orgIdentifier,
          this.defaultSource.id,
          !this.defaultSource.enabled,
        );
        toast({
          variant: "success",
          message: this.defaultSource.enabled
            ? this.t("alert_sources.disabledSuccess")
            : this.t("alert_sources.enabledSuccess"),
        });
        await this.fetchIntegrations();
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
