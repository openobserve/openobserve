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
    :title="t('ingestion.tokenManagementTitle')"
    title-data-test="ingestion-tokens-title-text"
    icon="key"
    bleed
  >
    <!-- Full explanation lives in this info tooltip; the subtitle below is a
           truncated preview so neither overruns the Create action button. -->
    <template #title-trail>
      <span class="inline-flex items-center">
        <OIcon
          name="info-outline"
          size="sm"
          class="text-text-secondary cursor-help"
          data-test="ingestion-tokens-info-icon"
        />
        <OTooltip :content="t('ingestion.orgLevelExplanation')" max-width="360px" />
      </span>
    </template>
    <!-- Short summary subtitle; the full explanation is in the title info tooltip. -->
    <template #subtitle>
      <span class="truncate min-w-0 leading-normal">{{ t("ingestion.orgLevelSummary") }}</span>
    </template>
    <template #actions>
      <OButton
        variant="primary"
        size="sm-action"
        data-test="add-ingestion-token"
        @click="showCreateForm = true"
      >
        {{ t("ingestion.createTokenBtn") }}
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
          :default-columns="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="iam-ingestion-tokens"
          filter-mode="client"
        >
          <template #toolbar>
            <div class="flex items-center gap-2 w-full">
              <OSearchInput
                v-model="filterQuery"
                :placeholder="t('ingestion.searchToken', 'Search tokens')"
                class="flex-1"
                data-test="ingestion-tokens-search-input"
              />
            </div>
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="ingestion-tokens-refresh-btn"
              @click="fetchTokens"
            >
              <OTooltip
                side="bottom"
                :content="t('common.refresh')"
                shortcut-id="ingestionTokensRefresh"
              />
            </OButton>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-ingestion-tokens"
              :filtered="!!filterQuery"
              @action="
                (id) => (id === 'clear-filters' ? (filterQuery = '') : (showCreateForm = true))
              "
            />
          </template>

          <template #cell-name="{ row }">
            <span class="font-medium">{{ row.name }}</span>
          </template>

          <!-- Copy yields a ready-to-paste "Basic base64(name:token)" credential
               (OCodeCell copies exactly what it shows), so no manual email +
               base64 step is needed. -->
          <template #cell-token="{ row }">
            <OCodeCell :value="toBasicAuth(row.name, row.token)" />
          </template>

          <template #cell-created_by="{ row }">
            <OUserCell :value="row.created_by" />
          </template>

          <template #cell-actions="{ row }">
            <OButton
              :data-test="`ingestion-token-${row.name}-toggle`"
              :icon-left="row.enabled ? 'pause' : 'play-arrow'"
              :variant="row.enabled ? 'ghost-destructive' : 'ghost-success'"
              size="icon-sm"
              :title="row.enabled ? t('common.disable') : t('common.enable')"
              :disabled="loading"
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
      :title="t('ingestion.createTokenTitle')"
      :primary-button-label="t('common.create')"
      :secondary-button-label="t('common.cancel')"
      form-id="create-token-form"
      @click:secondary="showCreateForm = false"
    >
      <OForm
        id="create-token-form"
        :schema="createTokenSchema"
        :default-values="createTokenDefaults()"
        @submit="createToken"
      >
        <OFormInput
          name="name"
          :label="t('ingestion.tokenNameLabel')"
          required
          :maxlength="256"
          autofocus
          data-test="ingestion-token-name-input"
        />
        <OFormInput
          name="description"
          :label="t('ingestion.tokenDescriptionLabel')"
          class="mt-4"
          data-test="ingestion-token-description-input"
        />
      </OForm>
    </ODialog>

    <!-- Revealed token dialog -->
    <ODialog
      v-model:open="showRevealedDialog"
      :persistent="true"
      size="sm"
      :title="t('ingestion.newTokenRevealed')"
      :secondary-button-label="t('common.close')"
      @click:secondary="showRevealedDialog = false"
    >
      <!-- Primary: the ready-to-paste Authorization credential. -->
      <div class="mb-1 text-xs font-medium text-text-label">
        {{ t("ingestion.authHeaderLabel") }}
      </div>
      <div
        class="p-2.5 border border-dashed rounded-default border-border-default mb-1 bg-surface-subtle"
      >
        <code class="break-all font-mono text-sm">{{ revealedBasicAuth }}</code>
      </div>
      <div class="mb-3 text-xs text-text-secondary">
        {{ t("ingestion.authHeaderHelp") }}
      </div>
      <div class="flex justify-end gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          icon="content-copy"
          @click="copyToken(revealedToken?.token || '')"
        >
          {{ t("ingestion.copyRawTokenBtn") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          icon="content-copy"
          @click="copyToken(revealedBasicAuth)"
        >
          {{ t("ingestion.copyAuthHeaderBtn") }}
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
import OCodeCell from "@/lib/core/Table/cells/OCodeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import {
  makeCreateTokenSchema,
  createTokenDefaults,
  type CreateTokenForm,
} from "./IngestionTokens.schema";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import { getBasicAuth } from "@/utils/auth";
import organizationsService from "@/services/organizations";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

interface Token {
  name: string;
  token: string;
  description: string;
  is_default: boolean;
  enabled: boolean;
  created_by: string;
  created_at: number;
}

export default defineComponent({
  name: "IngestionTokens",
  components: {
    OPageLayout,
    OButton,
    OEmptyState,
    OIcon,
    OSearchInput,
    OTooltip,
    ODialog,
    OForm,
    OFormInput,
    OTable,
    OCodeCell,
    OUserCell,
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();

    // Create-token dialog is an OForm — the schema (name required + max 256) and
    // its defaults factory MUST be returned from setup() (Options-API), else
    // :schema/:default-values resolve to undefined.
    const createTokenSchema = makeCreateTokenSchema(t);

    const tokens = ref<Token[]>([]);
    const loading = ref(false);
    const filterQuery = ref("");
    const showCreateForm = ref(false);
    const showRevealedDialog = ref(false);
    const revealedToken = ref<{ name: string; token: string } | null>(null);

    // Ready-to-paste "Basic base64(name:token)" credential shown in the
    // "New Token Generated" dialog (restored — the merge auto-drop lost it).
    const revealedBasicAuth = computed(() =>
      revealedToken.value ? getBasicAuth(revealedToken.value.name, revealedToken.value.token) : "",
    );

    const columns: OTableColumnDef<Token>[] = [
      {
        id: "name",
        header: t("ingestion.tokenNameLabel"),
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
        header: t("ingestion.tokenAuthHeader"),
        accessorKey: "token",
        sortable: false,
        resizable: true,
        hideable: true,
        // Wide enough for the truncated credential + gap + copy btn.
        size: 340,
        meta: { align: "left" },
      },
      {
        id: "created_by",
        header: t("ingestion.createdBy"),
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
        const res = await organizationsService.list_org_ingestion_tokens(
          store.state.selectedOrganization.identifier,
        );
        tokens.value = res.data.data;
      } catch (e: any) {
        toast({
          variant: "error",
          message: e.response?.data?.message || t("ingestion.tokenFetchError"),
          timeout: 5000,
        });
      } finally {
        loading.value = false;
      }
    };

    // Plain async @submit handler — fires only after the schema passes (name
    // required + max 256). Awaited by OForm, so the footer Save spinner spans the
    // request automatically (no disabled gate). The dialog unmounts its body on
    // close, so there's no model to reset.
    const createToken = async (value: CreateTokenForm) => {
      loading.value = true;
      try {
        const res = await organizationsService.create_org_ingestion_token(
          store.state.selectedOrganization.identifier,
          {
            name: value.name.trim(),
            description: (value.description ?? "").trim(),
          },
        );
        revealedToken.value = {
          name: value.name.trim(),
          token: res.data.data.token,
        };
        showCreateForm.value = false;
        showRevealedDialog.value = true;
        await fetchTokens();
        store.dispatch("setOrgTokens", tokens.value);
        toast({
          variant: "success",
          message: t("ingestion.tokenCreatedSuccess"),
          timeout: 5000,
        });
      } catch (e: any) {
        toast({
          variant: "error",
          message: e.response?.data?.message || t("ingestion.tokenCreateError"),
          timeout: 5000,
        });
      } finally {
        loading.value = false;
      }
    };

    const toggleEnabled = async (name: string, enabled: boolean) => {
      loading.value = true;
      try {
        await organizationsService.enable_disable_org_ingestion_token(
          store.state.selectedOrganization.identifier,
          name,
          enabled,
        );
        await fetchTokens();
        store.dispatch("setOrgTokens", tokens.value);
        toast({
          variant: "success",
          message: enabled
            ? t("iam.ingestionTokensPage.tokenEnabledSuccess")
            : t("iam.ingestionTokensPage.tokenDisabledSuccess"),
          timeout: 3000,
        });
      } catch (e: any) {
        toast({
          variant: "error",
          message: e.response?.data?.message || t("iam.ingestionTokensPage.tokenUpdateError"),
          timeout: 5000,
        });
      } finally {
        loading.value = false;
      }
    };

    // Build a ready-to-paste Authorization value: "Basic base64(name:token)".
    // The username part is the TOKEN NAME (not a user email): org ingestion
    // tokens are org-scoped and the backend ignores the username, so using the
    // token name keeps the credential person-independent (never goes stale when
    // a user leaves) and gives meaningful ingestion-log attribution.
    const toBasicAuth = (name: string, token: string) => getBasicAuth(name, token);

    const copyToken = (token: string) => {
      copyToClipboard(token);
    };

    onBeforeMount(() => {
      fetchTokens();
    });

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useShortcuts([
      {
        id: "ingestionTokensAdd",
        handler: () => {
          if (!isInputFocused()) showCreateForm.value = true;
        },
      },
      {
        id: "ingestionTokensRefresh",
        handler: () => {
          if (!isInputFocused()) fetchTokens();
        },
      },
      {
        id: "ingestionTokensFocusSearch",
        handler: () => {
          focusSearchInput("ingestion-tokens-search-input");
        },
      },
    ]);

    return {
      store,
      t,
      tokens,
      loading,
      filterQuery,
      columns,
      showCreateForm,
      showRevealedDialog,
      revealedToken,
      revealedBasicAuth,
      fetchTokens,
      createToken,
      createTokenSchema,
      createTokenDefaults,
      toggleEnabled,
      copyToken,
      toBasicAuth,
    };
  },
});
</script>
