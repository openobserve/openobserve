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
    :title="t('iam.ingestionTokens')"
    title-data-test="ingestion-tokens-title-text"
    :about="aboutText"
    bleed
  >
    <template #actions>
      <OButton variant="primary" data-test="add-ingestion-token" @click="openCreate">
        {{ t("ingestion.createTokenBtn") }}
      </OButton>
    </template>

    <div class="min-h-0 w-full flex-1 overflow-hidden">
      <div class="bg-card-glass-bg h-full">
        <OTable
          :data="tokens"
          :columns="columns"
          row-key="name"
          :row-actions="rowActions"
          :row-menu="rowMenu"
          :loading="loading"
          :forbidden="forbidden"
          v-model:global-filter="filterQuery"
          :default-columns="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="iam-ingestion-tokens"
          filter-mode="client"
          pagination="client"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          sorting="client"
        >
          <template #toolbar>
            <div class="flex min-w-0 flex-1 items-center gap-2 max-md:contents">
              <OSearchInput
                v-model="filterQuery"
                :placeholder="t('ingestion.searchToken')"
                class="flex-1"
                data-test="ingestion-tokens-search-input"
              />
            </div>
          </template>
          <template #footer-note>
            <span class="text-text-secondary text-xs" data-test="ingestion-tokens-rotation-note">
              {{ t("ingestion.rotationNote") }}
            </span>
          </template>
          <template #toolbar-trailing>
            <ORefreshButton
              :last-run-at="lastUpdatedAt"
              :loading="fetching"
              shortcut="ingestionTokensRefresh"
              data-test="ingestion-tokens-refresh-btn"
              @click="refreshTokens"
            />
          </template>
          <template #empty>
            <OEmptyState
              :kind="filterQuery ? 'filtered' : 'first-run'"
              :title="
                filterQuery
                  ? t('emptyState.filtered.title', { noun: t('emptyState.nouns.ingestionTokens') })
                  : t('emptyState.noIngestionTokens.title')
              "
              :text="
                filterQuery
                  ? t('emptyState.filtered.description', {
                      noun: t('emptyState.nouns.ingestionTokens'),
                    })
                  : t('emptyState.noIngestionTokens.description')
              "
              :action-label="filterQuery ? undefined : t('emptyState.noIngestionTokens.action')"
              @action="filterQuery ? (filterQuery = '') : openCreate()"
            />
          </template>

          <template #cell-name="{ row }">
            <span
              v-if="isSystemIngestionToken(row)"
              class="inline-flex max-w-full min-w-0 items-center gap-2"
            >
              <span class="min-w-0 truncate font-medium">
                {{ row.name }}
                <OTooltip overflow-only />
              </span>
              <span
                class="inline-flex shrink-0 items-center gap-1"
                :data-test="`ingestion-token-${row.name}-system`"
              >
                <OTag tone="neutral" size="sm" :label="t('ingestion.systemTokenTag')" />
                <OIcon name="info-outline" size="sm" class="text-text-secondary cursor-help" />
                <OTooltip :content="t('ingestion.systemTokenHint')" />
              </span>
            </span>
            <span v-else class="font-medium">{{ row.name }}</span>
          </template>

          <!-- Masked until revealed; Copy yields a ready-to-paste "Basic base64(name:token)". -->
          <template #cell-token="{ row }">
            <OSecretCell
              :value="
                isReservedIngestionTokenName(row.name) ? null : toBasicAuth(row.name, row.token)
              "
              mask="Basic ••••••••"
              :data-test="`ingestion-token-${row.name}-auth`"
            />
          </template>

          <template #cell-splunk_token="{ row }">
            <OSecretCell
              :value="row.splunk_token"
              :empty-label="t('ingestion.splunkTokenNone')"
              :data-test="`ingestion-token-${row.name}-splunk-value`"
            />
          </template>

          <template #cell-status="{ row }">
            <OTag type="featureStatus" :value="row.enabled ? 'enabled' : 'disabled'" />
          </template>

          <template #cell-created_by="{ row }">
            <OUserCell :value="row.created_by" />
          </template>
        </OTable>
      </div>
    </div>

    <!-- Create token dialog -->
    <ODialog
      v-model:open="showCreateForm"
      size="sm"
      :title="t('ingestion.createTokenTitle')"
      :primary="{ label: t('common.create') }"
      :secondary="{ label: t('common.cancel') }"
      form-id="create-token-form"
      @click:secondary="showCreateForm = false"
    >
      <OForm
        id="create-token-form"
        :schema="createTokenSchema"
        :default-values="createDefaults"
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
        <OFormCheckbox
          name="splunk_token"
          :label="t('ingestion.splunkTokenCreateLabel')"
          class="mt-4"
          data-test="ingestion-token-splunk-checkbox"
        />
        <div class="text-text-secondary mt-1 text-xs">
          {{ t("ingestion.splunkTokenCreateHint") }}
        </div>
      </OForm>
    </ODialog>

    <ODialog
      v-model:open="showRotateDialog"
      size="sm"
      :title="t('ingestion.rotateTitle', { name: rotateName })"
      :primary="{ label: t('ingestion.rotateCreateNew') }"
      :secondary="{ label: t('common.cancel') }"
      data-test="ingestion-token-rotate-dialog"
      @click:primary="startRotation"
      @click:secondary="showRotateDialog = false"
    >
      <ol class="text-text-body flex list-decimal flex-col gap-2 ps-5 text-sm">
        <li>{{ t("ingestion.rotateStep1") }}</li>
        <li>{{ t("ingestion.rotateStep2") }}</li>
        <li>{{ t("ingestion.rotateStep3", { name: rotateName }) }}</li>
      </ol>
      <div class="text-text-secondary mt-3 text-xs">{{ t("ingestion.rotateNever") }}</div>
    </ODialog>

    <!-- Revealed token dialog -->
    <ODialog
      v-model:open="showRevealedDialog"
      persistent
      size="sm"
      :title="t('ingestion.newTokenRevealed')"
      :secondary="{ label: t('common.close') }"
      @click:secondary="showRevealedDialog = false"
    >
      <!-- Primary: the ready-to-paste Authorization credential. -->
      <div class="text-text-label mb-1 text-xs font-medium">
        {{ t("ingestion.authHeaderLabel") }}
      </div>
      <div
        class="rounded-default border-border-default bg-surface-subtle mb-1 border border-dashed p-2.5"
      >
        <code class="font-mono text-sm break-all">{{ revealedBasicAuth }}</code>
      </div>
      <div class="text-text-secondary mb-3 text-xs">
        {{ t("ingestion.authHeaderHelp") }}
      </div>
      <template v-if="revealedToken?.splunk_token">
        <div class="text-text-label mb-1 text-xs font-medium">
          {{ t("ingestion.splunkTokenColumn") }}
        </div>
        <div
          class="rounded-default border-border-default bg-surface-subtle mb-3 border border-dashed p-2.5"
        >
          <code class="font-mono text-sm break-all">{{ revealedToken.splunk_token }}</code>
        </div>
        <div class="text-text-label mb-1 text-xs font-medium">
          {{ t("ingestion.splunkHecUrlLabel") }}
        </div>
        <div
          class="rounded-default border-border-default bg-surface-subtle mb-1 border border-dashed p-2.5"
        >
          <code class="font-mono text-sm break-all">{{ hecUrl }}</code>
        </div>
        <div class="text-text-secondary mb-3 text-xs">
          {{ t("ingestion.splunkHecUrlHelp") }}
        </div>
      </template>
      <div class="flex justify-end gap-2">
        <OButton
          v-if="revealedToken?.splunk_token"
          variant="secondary"
          icon="content-copy"
          data-test="copy-splunk-token-btn"
          @click="copyToken(revealedToken?.splunk_token || '')"
        >
          {{ t("ingestion.splunkTokenColumn") }}
        </OButton>
        <OButton
          variant="secondary"
          icon="content-copy"
          @click="copyToken(revealedToken?.token || '')"
        >
          {{ t("ingestion.copyRawTokenBtn") }}
        </OButton>
        <OButton variant="primary" icon="content-copy" @click="copyToken(revealedBasicAuth)">
          {{ t("ingestion.copyAuthHeaderBtn") }}
        </OButton>
      </div>
    </ODialog>
  </OPageLayout>
</template>

<script lang="ts">
import { useQuery } from "@tanstack/vue-query";
import {
  createIngestionTokenMutation,
  setIngestionSplunkTokenMutation,
  setIngestionTokenEnabledMutation,
} from "@/services/organizations.queries";
import { useOrgId } from "@/composables/query/useOrgId";
import { useMutation } from "@tanstack/vue-query";
import { ingestionTokensQuery } from "@/services/organizations.queries";
import analytics from "@/services/product_analytics";
import { ref, computed, defineComponent, onBeforeMount, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSecretCell from "@/lib/core/Table/cells/OSecretCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import {
  makeCreateTokenSchema,
  createTokenDefaults,
  type CreateTokenForm,
} from "./IngestionTokens.schema";
import {
  COL,
  type OTableColumnDef,
  type OTableRowAction,
  type OTableRowMenuItem,
} from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import { getBasicAuth } from "@/utils/auth";
import {
  isReservedIngestionTokenName,
  isSystemIngestionToken,
  pickableIngestionTokens,
} from "@/utils/ingestionTokens";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import { forbiddenState } from "@/utils/featureGate";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

interface Token {
  name: string;
  token: string;
  description: I18nText;
  is_default: boolean;
  enabled: boolean;
  created_by: string;
  created_at: number;
  splunk_token?: string | null;
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
    ORefreshButton,
    ODialog,
    OForm,
    OFormInput,
    OFormCheckbox,
    OTable,
    OTag,
    OSecretCell,
    OUserCell,
  },
  setup() {
    const store = useStore();
    const { t } = useI18nTyped();

    // Create-token dialog is an OForm — the schema (name required + max 256) and
    // its defaults factory MUST be returned from setup() (Options-API), else
    // :schema/:default-values resolve to undefined.
    const createTokenSchema = makeCreateTokenSchema(t);

    const aboutText = computed(() => raw(t("ingestion.orgLevelExplanation")));

    const orgIdForList = useOrgId();
    const tokensList = useQuery(() =>
      Object.assign(ingestionTokensQuery(orgIdForList.value), { enabled: !!orgIdForList.value }),
    );

    // The table is the query, not a copy of it: a token write invalidates the
    // scope and these rows repaint with no wiring here.
    const tokens = computed(() => {
      const data = tokensList.data.value;
      return (data as any)?.data ?? [];
    });
    const loading = tokensList.isPending;
    // A request is in flight while rows stay on screen — the refresh button's
    // spinner. `loading` is the skeleton, which only a cold read wants.
    const fetching = tokensList.isFetching;
    // Epoch ms of the last successful read — drives the button's "1m ago" label.
    const lastUpdatedAt = tokensList.dataUpdatedAt;
    // A 403 lands in the query's error rather than a loader's catch, so derive the no-access state from it.
    const forbidden = computed(() => {
      const e: any = tokensList.error.value;
      return forbiddenState(e) || e?.status === 403;
    });
    const filterQuery = ref("");
    const showCreateForm = ref(false);
    const showRotateDialog = ref(false);
    const rotateTarget = ref<Token | null>(null);
    const createDefaults = ref(createTokenDefaults());
    const rotateName = computed(() => rotateTarget.value?.name ?? "");
    const showRevealedDialog = ref(false);
    const revealedToken = ref<{ name: string; token: string; splunk_token?: string } | null>(null);
    const { confirm } = useConfirmDialog();

    // Splunk forwarders take a bare host, so the collector is always at the
    // server root — never under a base URI.
    const hecUrl = computed(() => `${window.location.origin}/services/collector`);

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
        size: 240,
        minSize: 140,
        meta: { align: "left", flex: true, cellOverflowTooltip: false },
      },
      {
        id: "splunk_token",
        header: t("ingestion.splunkTokenColumn"),
        accessorKey: "splunk_token",
        sortable: false,
        resizable: true,
        hideable: true,
        size: 200,
        minSize: 140,
        meta: { align: "left", flex: true, cellOverflowTooltip: false },
      },
      {
        id: "status",
        header: t("ingestion.tokenStatus"),
        accessorKey: "enabled",
        sortable: true,
        hideable: true,
        size: 120,
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
    ];

    // Opens the walkthrough only: the backend has no rotate, so nothing is created or disabled here.
    const openRotate = (row: Token) => {
      rotateTarget.value = row;
      showRotateDialog.value = true;
    };

    const startRotation = () => {
      const name = rotateTarget.value?.name ?? "";
      createDefaults.value = {
        ...createTokenDefaults(),
        name: t("ingestion.rotateNewName", { name }),
        description: t("ingestion.rotateDescription", { name }),
      };
      showRotateDialog.value = false;
      showCreateForm.value = true;
    };

    const rowMenu: OTableRowMenuItem<Token>[] = [
      {
        id: "rotate",
        label: () => t("ingestion.rotateAction"),
        icon: "refresh",
        onSelect: (row) => openRotate(row),
        hidden: (row) => isReservedIngestionTokenName(row.name),
        dataTest: (row) => `ingestion-token-${row.name}-rotate`,
      },
    ];

    const rowActions: OTableRowAction<Token>[] = [
      {
        id: "splunk",
        label: (row) =>
          row.splunk_token ? t("ingestion.splunkTokenRevoke") : t("ingestion.splunkTokenGenerate"),
        icon: (row) => (row.splunk_token ? "link-off" : "link"),
        onClick: (row) => setSplunkToken(row.name, !row.splunk_token),
        hidden: (row) => isReservedIngestionTokenName(row.name),
        disabled: () => loading.value,
        dataTest: (row) => `ingestion-token-${row.name}-splunk`,
      },
      {
        id: "toggle",
        label: (row) => (row.enabled ? t("common.disable") : t("common.enable")),
        icon: (row) => (row.enabled ? "pause" : "play-arrow"),
        onClick: (row) => toggleEnabled(row.name, !row.enabled),
        disabled: () => loading.value,
        dataTest: (row) => `ingestion-token-${row.name}-toggle`,
      },
    ];

    // The query owns its failure now, so this reports it once per error however
    // the read was triggered.
    watch(tokensList.error, (e: any) => {
      if (!e || forbidden.value) return;
      toast({
        variant: "error",
        message: e.response?.data?.message || t("ingestion.tokenFetchError"),
        timeout: 5000,
      });
    });

    // Only an explicit call reads: refresh, post-write reload, search. Mount and
    // invalidation-driven repaints come from the query itself.
    const fetchTokens = async (force = false) => {
      if (force) await tokensList.refetch();
    };

    // Named handler: binding fetchTokens straight to @click puts the DOM event
    // in `force`, and without it the button is a no-op while the entry is fresh.
    const refreshTokens = () => fetchTokens(true);

    // Plain async @submit handler — fires only after the schema passes (name
    // required + max 256). Awaited by OForm, so the footer Save spinner spans the
    // request automatically (no disabled gate). The dialog unmounts its body on
    // close, so there's no model to reset.
    const orgIdForWrites = useOrgId();
    const createIngestionToken = useMutation(() =>
      createIngestionTokenMutation(orgIdForWrites.value),
    );
    const setIngestionTokenEnabled = useMutation(() =>
      setIngestionTokenEnabledMutation(orgIdForWrites.value),
    );
    const setIngestionSplunkToken = useMutation(() =>
      setIngestionSplunkTokenMutation(orgIdForWrites.value),
    );

    const createToken = async (value: CreateTokenForm) => {
      loading.value = true;
      try {
        const res = await createIngestionToken.mutateAsync({
          name: value.name.trim(),
          description: (value.description ?? "").trim(),
          splunk_token: value.splunk_token ?? false,
        });
        revealedToken.value = {
          name: value.name.trim(),
          token: res.data.data.token,
          splunk_token: res.data.data.splunk_token ?? undefined,
        };
        showCreateForm.value = false;
        showRevealedDialog.value = true;
        await fetchTokens();
        store.dispatch("setOrgTokens", pickableIngestionTokens(tokens.value));
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

    const openCreate = () => {
      createDefaults.value = createTokenDefaults();
      showCreateForm.value = true;
    };

    const toggleEnabled = async (name: string, enabled: boolean) => {
      loading.value = true;
      try {
        await setIngestionTokenEnabled.mutateAsync({ name, enabled });
        analytics.track(enabled ? "ingestion_token_enabled" : "ingestion_token_disabled");
        await fetchTokens();
        store.dispatch("setOrgTokens", pickableIngestionTokens(tokens.value));
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

    const setSplunkToken = async (name: string, generate: boolean) => {
      if (!generate) {
        const confirmed = await confirm({
          title: t("ingestion.splunkTokenRevokeTitle"),
          messageKeypath: "ingestion.splunkTokenRevokeMessage",
          messageName: name,
          confirmLabel: t("ingestion.splunkTokenRevoke"),
          cancelLabel: t("common.cancel"),
          kind: "destructive",
        });
        if (!confirmed) return;
      }
      loading.value = true;
      try {
        await setIngestionSplunkToken.mutateAsync({
          name,
          action: generate ? "generate" : "revoke",
        });
        analytics.track(
          generate ? "ingestion_splunk_token_generated" : "ingestion_splunk_token_revoked",
        );
        await fetchTokens();
        toast({
          variant: "success",
          message: generate
            ? t("ingestion.splunkTokenGenerated")
            : t("ingestion.splunkTokenRevoked"),
          timeout: 3000,
        });
      } catch (e: any) {
        toast({
          variant: "error",
          message: e.response?.data?.message || t("ingestion.splunkTokenError"),
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
      copyToClipboard(token, t);
    };

    onBeforeMount(() => {
      fetchTokens();
    });

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useShortcuts([
      {
        id: "ingestionTokensAdd",
        handler: () => {
          if (!isInputFocused()) openCreate();
        },
      },
      {
        id: "ingestionTokensRefresh",
        handler: () => {
          if (!isInputFocused()) refreshTokens();
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
      aboutText,
      tokens,
      loading,
      fetching,
      lastUpdatedAt,
      forbidden,
      filterQuery,
      columns,
      rowActions,
      rowMenu,
      showCreateForm,
      showRotateDialog,
      rotateTarget,
      rotateName,
      startRotation,
      openCreate,
      createDefaults,
      showRevealedDialog,
      revealedToken,
      revealedBasicAuth,
      fetchTokens,
      refreshTokens,
      createToken,
      createTokenSchema,
      createTokenDefaults,
      toggleEnabled,
      setSplunkToken,
      hecUrl,
      copyToken,
      toBasicAuth,
      isSystemIngestionToken,
      isReservedIngestionTokenName,
    };
  },
});
</script>
