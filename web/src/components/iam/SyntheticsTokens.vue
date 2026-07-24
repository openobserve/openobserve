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
    :title="t('synthetics.tokens.title')"
    title-data-test="synthetics-tokens-title-text"
    icon="key"
    bleed
  >
    <template #title-trail>
      <span class="inline-flex items-center">
        <OIcon
          name="info-outline"
          size="sm"
          class="text-text-secondary cursor-help"
          data-test="synthetics-tokens-info-icon"
        />
        <OTooltip :content="t('synthetics.tokens.explanation')" max-width="360px" />
      </span>
    </template>
    <template #subtitle>
      <span class="truncate min-w-0 leading-normal">{{ t('synthetics.tokens.summary') }}</span>
    </template>
    <template #actions>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="refresh"
        data-test="synthetics-tokens-rotate-default-btn"
        @click="rotateDefault"
      >
        {{ t('synthetics.tokens.rotateDefaultBtn') }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        data-test="synthetics-tokens-create-btn"
        @click="showCreateForm = true"
      >
        {{ t('synthetics.tokens.createTokenBtn') }}
      </OButton>
    </template>

    <div class="w-full flex-1 min-h-0 overflow-hidden">
      <div class="bg-card-glass-bg h-full">
        <OTable
          :frame="false"
          :data="tokens"
          :columns="columns"
          row-key="name"
          :loading="loading"
          v-model:global-filter="filterQuery"
          :show-global-filter="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="iam-synthetics-tokens"
          filter-mode="client"
        >
          <template #toolbar>
            <div class="flex items-center gap-2 w-full">
              <OSearchInput
                v-model="filterQuery"
                :placeholder="t('synthetics.tokens.searchPlaceholder')"
                class="flex-1"
                data-test="synthetics-tokens-search-input"
              />
            </div>
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              :title="t('common.refresh')"
              data-test="synthetics-tokens-refresh-btn"
              @click="fetchTokens"
            />
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              illustration="browser-check"
              :filtered="!!filterQuery"
              :title="t('synthetics.tokens.empty.title')"
              :description="t('synthetics.tokens.empty.description')"
              data-test="synthetics-tokens-empty-state"
            />
          </template>

          <template #cell-name="{ row }">
            <div class="flex items-center gap-2 min-w-0">
              <span class="font-medium truncate">{{ row.name }}</span>
              <OTag v-if="row.is_default" variant="primary-soft" size="xs" shape="rounded">
                {{ t('synthetics.tokens.default') }}
              </OTag>
            </div>
          </template>

          <template #cell-token="{ row }">
            <span class="font-mono text-xs text-text-secondary">{{ row.token }}</span>
          </template>

          <template #cell-status="{ row }">
            <OBadge :variant="row.enabled ? 'success' : 'default'" :dot="true" size="sm">
              {{ row.enabled ? t('common.enable') : t('common.disable') }}
            </OBadge>
          </template>

          <template #cell-created_by="{ row }">
            <OUserCell :value="row.created_by" />
          </template>

          <template #cell-actions="{ row }">
            <OButton
              :data-test="`synthetics-token-${row.name}-toggle`"
              :icon-left="row.enabled ? 'pause' : 'play-arrow'"
              :variant="row.enabled ? 'ghost-destructive' : 'ghost-success'"
              size="icon-sm"
              :disabled="loading || (row.enabled && row.is_default)"
              :title="
                row.enabled && row.is_default
                  ? t('synthetics.tokens.disableDefaultBlocked')
                  : row.enabled
                    ? t('common.disable')
                    : t('common.enable')
              "
              @click.stop="toggleEnabled(row.name, !row.enabled)"
            />
          </template>
        </OTable>
      </div>
    </div>

    <!-- Create token dialog -->
    <ODialog
      v-model:open="showCreateForm"
      size="sm"
      :title="t('synthetics.tokens.createTokenTitle')"
      :primary-button-label="t('common.create')"
      :secondary-button-label="t('common.cancel')"
      form-id="create-synthetics-token-form"
      @click:secondary="showCreateForm = false"
    >
      <OForm
        id="create-synthetics-token-form"
        :schema="createTokenSchema"
        :default-values="createTokenDefaults()"
        @submit="createToken"
      >
        <OFormInput
          name="name"
          :label="t('synthetics.tokens.tokenNameLabel')"
          :placeholder="t('synthetics.tokens.tokenNamePlaceholder')"
          required
          :maxlength="256"
          autofocus
          data-test="synthetics-token-name-input"
        />
        <p class="mt-2 text-xs text-text-muted">
          {{ t('synthetics.tokens.tokenNameHint') }}
        </p>
      </OForm>
    </ODialog>

    <!-- Revealed token dialog (shown once) -->
    <ODialog
      v-model:open="showRevealedDialog"
      :persistent="true"
      size="sm"
      :title="t('synthetics.tokens.newTokenRevealed')"
      :secondary-button-label="t('common.close')"
      @click:secondary="showRevealedDialog = false"
    >
      <div class="mb-1 text-xs font-medium text-text-label">
        {{ t('synthetics.tokens.rawTokenLabel') }}
      </div>
      <div class="p-2.5 border border-dashed rounded-default border-border-default mb-3 bg-surface-subtle">
        <code class="break-all font-mono text-sm">{{ revealedToken?.token }}</code>
      </div>

      <!-- Ready-to-run install command with the named token baked in. -->
      <template v-if="installCommand">
        <div class="mb-1 text-xs font-medium text-text-label">
          {{ t('synthetics.tokens.installCmdLabel') }}
        </div>
        <div class="relative mb-1">
          <pre
            class="bg-surface-subtle border border-border-default rounded-default p-3 text-xs font-mono overflow-x-auto whitespace-pre"
            data-test="synthetics-token-install-cmd"
            >{{ installCommand }}</pre
          >
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="content-copy"
            class="absolute top-1 right-1"
            :title="t('common.copy')"
            data-test="synthetics-token-copy-cmd-btn"
            @click="copyCommand"
          />
        </div>
        <div class="mb-3 text-xs text-text-secondary">
          {{ t('synthetics.tokens.installCmdHint') }}
        </div>
      </template>
      <div v-else class="mb-3 text-xs text-text-secondary">
        {{ t('synthetics.tokens.installHint') }}
      </div>

      <div class="flex justify-end gap-2">
        <OButton
          :variant="installCommand ? 'outline' : 'primary'"
          size="sm-action"
          icon="content-copy"
          data-test="synthetics-token-copy-btn"
          @click="copyToken(revealedToken?.token || '')"
        >
          {{ t('synthetics.tokens.copyTokenBtn') }}
        </OButton>
        <OButton
          v-if="installCommand"
          variant="primary"
          size="sm-action"
          icon="content-copy"
          data-test="synthetics-token-copy-cmd-primary-btn"
          @click="copyCommand"
        >
          {{ t('synthetics.tokens.copyCmdBtn') }}
        </OButton>
      </div>
    </ODialog>
  </OPageLayout>
</template>

<script lang="ts">
import { ref, computed, defineComponent, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import {
  makeCreateTokenSchema,
  createTokenDefaults,
  type CreateTokenForm,
} from "./SyntheticsTokens.schema";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import syntheticsService from "@/services/synthetics";
import type { AgentSetup } from "@/types/synthetics";

interface AgentToken {
  name: string;
  token: string;
  is_default: boolean;
  enabled: boolean;
  agents: number;
  created_by: string;
  created_at: number;
}

export default defineComponent({
  name: "SyntheticsTokens",
  components: {
    OPageLayout, OButton, OEmptyState, OIcon, OSearchInput, OTooltip,
    ODialog, OForm, OFormInput, OTable, OBadge, OTag, OUserCell,
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();

    const createTokenSchema = makeCreateTokenSchema(t);

    const tokens = ref<AgentToken[]>([]);
    const loading = ref(false);
    const filterQuery = ref("");
    const showCreateForm = ref(false);
    const showRevealedDialog = ref(false);
    const revealedToken = ref<{ name: string; token: string } | null>(null);
    // Install-command ingredients (script/o2 url, org) — fetched once so a
    // freshly revealed token can ship as a ready-to-run command, not just a raw
    // string the operator has to splice into a setup flow themselves.
    const agentSetup = ref<AgentSetup | null>(null);

    // A ready-to-run docker install command with THIS token baked in. Empty
    // until the setup ingredients load (falls back to the plain paste hint).
    // `<location-name>` stays a placeholder — a token isn't tied to a location.
    const installCommand = computed(() => {
      const s = agentSetup.value;
      const tok = revealedToken.value?.token;
      if (!s || !s.script_url || !s.o2_url || !tok) return "";
      return [
        `curl -sSL ${s.script_url} | bash -s -- \\`,
        `  --platform=docker \\`,
        `  --o2-url=${s.o2_url} \\`,
        `  --org=${s.org} \\`,
        `  --token=${tok} \\`,
        `  --location="<location-name>"`,
      ].join("\n");
    });

    const columns: OTableColumnDef<AgentToken>[] = [
      {
        id: "name",
        header: t("synthetics.tokens.tokenNameLabel"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "token",
        header: t("synthetics.tokens.tokenColumn"),
        accessorKey: "token",
        sortable: false,
        resizable: true,
        hideable: true,
        size: 240,
        meta: { align: "left" },
      },
      {
        id: "status",
        header: t("synthetics.table.status"),
        accessorKey: "enabled",
        sortable: true,
        hideable: true,
        size: 120,
        meta: { align: "left" },
      },
      {
        id: "agents",
        header: t("synthetics.tokens.agentsColumn"),
        accessorKey: "agents",
        sortable: true,
        hideable: true,
        size: 90,
        meta: { align: "right" },
      },
      {
        id: "created_by",
        header: t("synthetics.tokens.createdBy"),
        accessorKey: "created_by",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.owner,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("common.actions"),
        accessorKey: "actions",
        sortable: false,
        isAction: true,
        size: 80,
        meta: { align: "center", actionCount: 1 },
      },
    ];

    const fetchTokens = async () => {
      loading.value = true;
      try {
        const res = await syntheticsService.listAgentTokens(
          store.state.selectedOrganization.identifier,
        );
        tokens.value = res.data.tokens ?? [];
      } catch (e: any) {
        toast({
          variant: "error",
          message: e.response?.data?.message || t("synthetics.tokens.fetchError"),
          timeout: 5000,
        });
      } finally {
        loading.value = false;
      }
    };

    const reveal = (name: string, token: string) => {
      revealedToken.value = { name, token };
      showRevealedDialog.value = true;
    };

    const createToken = async (value: CreateTokenForm) => {
      loading.value = true;
      try {
        const res = await syntheticsService.createAgentToken(
          store.state.selectedOrganization.identifier,
          value.name.trim(),
        );
        showCreateForm.value = false;
        reveal(res.data.name, res.data.token);
        await fetchTokens();
        toast({ variant: "success", message: t("synthetics.tokens.createSuccess"), timeout: 4000 });
      } catch (e: any) {
        toast({
          variant: "error",
          message: e.response?.data?.message || t("synthetics.tokens.createError"),
          timeout: 5000,
        });
      } finally {
        loading.value = false;
      }
    };

    const rotateDefault = async () => {
      loading.value = true;
      try {
        const res = await syntheticsService.rotateAgentToken(
          store.state.selectedOrganization.identifier,
        );
        reveal(res.data.name, res.data.token);
        await fetchTokens();
        toast({ variant: "success", message: t("synthetics.tokens.rotateSuccess"), timeout: 4000 });
      } catch (e: any) {
        toast({
          variant: "error",
          message: e.response?.data?.message || t("synthetics.tokens.rotateError"),
          timeout: 5000,
        });
      } finally {
        loading.value = false;
      }
    };

    const toggleEnabled = async (name: string, enabled: boolean) => {
      loading.value = true;
      try {
        await syntheticsService.setAgentTokenEnabled(
          store.state.selectedOrganization.identifier,
          name,
          enabled,
        );
        await fetchTokens();
        toast({
          variant: "success",
          message: enabled
            ? t("synthetics.tokens.enabledSuccess")
            : t("synthetics.tokens.disabledSuccess"),
          timeout: 3000,
        });
      } catch (e: any) {
        toast({
          variant: "error",
          message: e.response?.data?.message || t("synthetics.tokens.updateError"),
          timeout: 5000,
        });
      } finally {
        loading.value = false;
      }
    };

    const copyToken = (token: string) => {
      copyToClipboard(token);
    };

    const copyCommand = () => {
      if (installCommand.value) copyToClipboard(installCommand.value);
    };

    const fetchAgentSetup = async () => {
      try {
        const res = await syntheticsService.getAgentSetup(
          store.state.selectedOrganization.identifier,
        );
        agentSetup.value = (res.data ?? null) as AgentSetup | null;
      } catch {
        // Non-fatal — the reveal dialog falls back to the plain token + hint.
        agentSetup.value = null;
      }
    };

    onBeforeMount(() => {
      fetchTokens();
      fetchAgentSetup();
    });

    return {
      t,
      tokens,
      loading,
      filterQuery,
      columns,
      showCreateForm,
      showRevealedDialog,
      revealedToken,
      installCommand,
      copyCommand,
      fetchTokens,
      createToken,
      createTokenSchema,
      createTokenDefaults,
      rotateDefault,
      toggleEnabled,
      copyToken,
    };
  },
});
</script>
