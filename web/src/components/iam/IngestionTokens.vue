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
  <div style="min-height: inherit;">
    <div>
      <!-- Header bar -->
      <div class="card-container tw:mb-[0.625rem]">
        <div
          class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
          style="position: sticky; top: 0; z-index: 1000;"
        >
          <div
            class="tw:font-[600] tw:flex tw:items-center tw:gap-2 tw:w-full"
            data-test="ingestion-tokens-title-text"
          >
            {{ t("ingestion.tokenManagementTitle") }}
            <OIcon
              name="info-outline"
              size="sm"
              class="tw:cursor-pointer"
            >
              <OTooltip :content="t('ingestion.orgLevelExplanation')" max-width="400px" />
            </OIcon>
          </div>
          <div class="tw:w-full tw:flex tw:justify-end">
            <OButton
              variant="primary"
              size="sm-action"
              data-test="add-ingestion-token"
              @click="showCreateForm = true"
            >
              {{ t('ingestion.createTokenBtn') }}
            </OButton>
          </div>
        </div>
      </div>

      <div>
        <div class="tw:w-full tw:h-full">
          <div
            class="card-container"
            style="height: calc(100vh - var(--navbar-height) - 92px)"
          >
            <OTable
              :data="tokens"
              :columns="columns"
              row-key="name"
              :loading="loading"
              :sticky-header="true"
              :max-height="'calc(100vh - var(--navbar-height) - 92px)'"
            >
              <template #empty>
                <div class="tw:text-center tw:py-8">
                  <OIcon
                    name="key"
                    size="xl"
                  />
                  <div class="tw:mt-2 tw:text-gray-500">
                    {{ t("ingestion.noTokensFound") }}
                  </div>
                </div>
              </template>

              <template #cell-name="{ row }">
                <span class="tw:font-medium">{{ row.name }}</span>
              </template>

              <template #cell-token="{ row }">
                <code
                  class="tw:font-mono tw:px-2 tw:py-1 tw:rounded tw:text-sm"
                  style="background: rgba(0,0,0,0.06);"
                >{{ row.token }}</code>
                <OButton
                  variant="ghost"
                  size="icon-circle-sm"
                  icon="content-copy"
                  class="tw:ml-2"
                  :title="t('ingestion.copyTokenBtn')"
                  @click="copyToken(row.token)"
                />
              </template>

              <template #cell-created_by="{ row }">
                <span class="tw:text-gray-500">{{ row.created_by }}</span>
              </template>

              <template #cell-actions="{ row }">
                <OButton
                  :data-test="`ingestion-token-${row.name}-toggle`"
                  class="material-symbols-outlined"
                  :variant="row.enabled ? 'ghost-destructive' : 'ghost'"
                  size="icon-circle-sm"
                  :title="row.enabled ? t('common.disable') : t('common.enable')"
                  :disabled="loading"
                  @click.stop="toggleEnabled(row.name, !row.enabled)"
                >
                  <OIcon :name="row.enabled ? 'pause' : 'play-arrow'" />
                </OButton>
              </template>
            </OTable>
          </div>
        </div>
      </div>
    </div>

    <!-- Create token dialog -->
    <ODialog
      v-model:open="showCreateForm"
      :persistent="true"
      size="sm"
      :title="t('ingestion.createTokenTitle')"
      :primary-button-label="t('common.create')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-disabled="!newTokenName.trim() || loading"
      @click:primary="createToken"
      @click:secondary="showCreateForm = false"
    >
      <OInput
        v-model="newTokenName"
        :label="t('ingestion.tokenNameLabel') + ' *'"
        :maxlength="256"
        autofocus
      />
      <OInput
        v-model="newTokenDescription"
        :label="t('ingestion.tokenDescriptionLabel')"
        class="tw:mt-4"
      />
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
      <div
        class="tw:p-2.5 tw:border tw:border-dashed tw:rounded tw:border-gray-400 tw:mb-4"
        :class="store.state.theme === 'dark' ? 'tw:bg-gray-800' : 'tw:bg-gray-100'"
      >
        <code
          class="tw:break-all tw:font-mono tw:text-sm"
        >{{ revealedToken?.token }}</code>
      </div>
      <div class="tw:flex tw:justify-end tw:gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          icon="content-copy"
          @click="copyToken(revealedToken?.token || '')"
        >
          {{ t('ingestion.copyTokenBtn') }}
        </OButton>
      </div>
    </ODialog>
  </div>
</template>

<script lang="ts">
import { ref, defineComponent, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import organizationsService from "@/services/organizations";

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
  components: { OButton, OIcon, OTooltip, ODialog, OInput, OTable },
  setup() {
    const store = useStore();
    const { t } = useI18n();

    const tokens = ref<Token[]>([]);
    const loading = ref(false);
    const showCreateForm = ref(false);
    const showRevealedDialog = ref(false);
    const newTokenName = ref("");
    const newTokenDescription = ref("");
    const revealedToken = ref<{ name: string; token: string } | null>(null);

    const columns: OTableColumnDef<Token>[] = [
      {
        id: "name",
        header: t("ingestion.tokenNameLabel"),
        accessorKey: "name",
        sortable: true,
      },
      {
        id: "token",
        header: t("serviceAccounts.token"),
        accessorKey: "token",
        sortable: false,
      },
      {
        id: "created_by",
        header: t("ingestion.createdBy"),
        accessorKey: "created_by",
        sortable: true,
        size: 200,
      },
      {
        id: "actions",
        header: t("common.actions"),
        accessorKey: "actions",
        sortable: false,
        isAction: true,
        size: 80,
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

    const createToken = async () => {
      if (!newTokenName.value.trim()) return;
      loading.value = true;
      try {
        const res = await organizationsService.create_org_ingestion_token(
          store.state.selectedOrganization.identifier,
          {
            name: newTokenName.value.trim(),
            description: newTokenDescription.value.trim(),
          },
        );
        revealedToken.value = {
          name: newTokenName.value.trim(),
          token: res.data.data.token,
        };
        newTokenName.value = "";
        newTokenDescription.value = "";
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
          message:
            e.response?.data?.message || t("ingestion.tokenCreateError"),
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
          message: `Token ${enabled ? "enabled" : "disabled"} successfully.`,
          timeout: 3000,
        });
      } catch (e: any) {
        toast({
          variant: "error",
          message: e.response?.data?.message || "Failed to update token.",
          timeout: 5000,
        });
      } finally {
        loading.value = false;
      }
    };

    const copyToken = async (token: string) => {
      await copyToClipboard(token);
      toast({
        variant: "success",
        message: t("common.copied") || "Copied!",
        timeout: 3000,
      });
    };

    onBeforeMount(() => {
      fetchTokens();
    });

    return {
      store,
      t,
      tokens,
      loading,
      columns,
      showCreateForm,
      showRevealedDialog,
      newTokenName,
      newTokenDescription,
      revealedToken,
      fetchTokens,
      createToken,
      toggleEnabled,
      copyToken,
    };
  },
});
</script>
