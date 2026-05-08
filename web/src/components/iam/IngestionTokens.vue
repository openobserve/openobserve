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
  <q-page class="q-pa-none" style="min-height: inherit;">
    <div>
      <!-- Header bar -->
      <div class="card-container tw:mb-[0.625rem]">
        <div
          class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
          style="position: sticky; top: 0; z-index: 1000;"
        >
          <div
            class="q-table__title full-width tw:font-[600]"
            data-test="ingestion-tokens-title-text"
          >
            {{ t("ingestion.tokenManagementTitle") }}
          </div>
          <div class="full-width tw:flex tw:justify-end">
            <q-btn
              v-if="isAdmin"
              class="q-ml-sm o2-primary-button tw:h-[36px]"
              flat
              no-caps
              icon="add"
              :label="t('ingestion.createTokenBtn')"
              @click="showCreateForm = true"
            />
          </div>
        </div>
      </div>

      <div>
        <div class="tw:w-full tw:h-full">
          <div
            class="card-container"
            style="height: calc(100vh - var(--navbar-height) - 92px)"
          >
            <!-- Info banner -->
            <q-banner
              class="bg-info text-white rounded-borders"
            >
              <template #avatar>
                <q-icon name="info" color="white" />
              </template>
              {{ t("ingestion.orgLevelExplanation") }}
            </q-banner>

            <q-table
              ref="qTable"
              :rows="tokens"
              :columns="columns"
              row-key="name"
              :pagination="pagination"
              :loading="loading"
              class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
              style="overflow-y: auto;"
              :style="tokens.length > 0
                ? 'height: calc(100vh - var(--navbar-height) - 156px); overflow-y: auto;'
                : ''"
            >
              <template #no-data>
                <div class="text-center q-py-lg">
                  <q-icon
                    name="vpn_key"
                    size="3rem"
                    :color="store.state.theme === 'dark' ? 'grey-6' : 'grey-5'"
                  />
                  <div
                    :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                    class="q-mt-sm"
                  >
                    {{ t("ingestion.noTokensFound") }}
                  </div>
                </div>
              </template>

              <template #body-cell-name="props">
                <q-td :props="props">
                  <div class="row items-center q-gutter-xs">
                    <span class="text-weight-medium">{{ props.row.name }}</span>
                    <q-badge
                      v-if="props.row.is_default"
                      color="primary"
                      :label="t('ingestion.defaultTokenBadge')"
                      class="text-caption"
                    />
                  </div>
                </q-td>
              </template>

              <template #body-cell-token="props">
                <q-td :props="props">
                  <code
                    :class="store.state.theme === 'dark' ? 'text-grey-3' : 'text-black'"
                    class="tw:font-mono tw:px-2 tw:py-1 tw:rounded"
                    style="background: rgba(0,0,0,0.06); font-size: 0.85rem"
                  >
                    {{ props.row.token }}
                  </code>
                  <q-btn
                    flat
                    dense
                    round
                    size="sm"
                    icon="content_copy"
                    class="q-ml-sm"
                    @click="copyToken(props.row.token)"
                  >
                    <q-tooltip>{{ t("ingestion.copyTokenBtn") }}</q-tooltip>
                  </q-btn>
                </q-td>
              </template>

              <template #body-cell-created_by="props">
                <q-td :props="props">
                  <span :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'">
                    {{ props.row.created_by }}
                  </span>
                </q-td>
              </template>

              <template #body-cell-actions="props">
                <q-td :props="props" side>
                  <q-btn
                    v-if="props.row.enabled"
                    :label="t('common.disable')"
                    class="o2-primary-button tw:h-[28px]"
                    flat
                    no-caps
                    size="sm"
                    :disable="loading"
                    @click="toggleEnabled(props.row.name, false)"
                  />
                  <q-btn
                    v-else
                    :label="t('common.enable')"
                    class="o2-primary-button tw:h-[28px]"
                    flat
                    no-caps
                    size="sm"
                    :disable="loading"
                    @click="toggleEnabled(props.row.name, true)"
                  />
                </q-td>
              </template>
            </q-table>
          </div>
        </div>
      </div>
    </div>

    <!-- Create token dialog -->
    <q-dialog v-model="showCreateForm" persistent>
      <q-card
        :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
        style="width: 480px; max-width: 90vw"
      >
        <q-card-section class="row items-center q-pb-none">
          <span class="text-h6">{{ t("ingestion.createTokenTitle") }}</span>
          <q-space />
          <q-btn flat round dense icon="close" @click="showCreateForm = false" />
        </q-card-section>
        <q-card-section>
          <q-input
            v-model="newTokenName"
            :label="t('ingestion.tokenNameLabel')"
            :dark="store.state.theme === 'dark'"
            outlined
            dense
            autofocus
            :rules="[(val: string) => !!val.trim() || 'Name is required']"
            class="q-mb-sm"
            maxlength="256"
          />
          <q-input
            v-model="newTokenDescription"
            :label="t('ingestion.tokenDescriptionLabel')"
            :dark="store.state.theme === 'dark'"
            outlined
            dense
            class="q-mb-sm"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            flat
            no-caps
            :label="t('common.cancel')"
            @click="showCreateForm = false"
          />
          <q-btn
            :class="
              store.state.theme === 'dark'
                ? 'o2-primary-button-dark'
                : 'o2-primary-button-light'
            "
            class="o2-primary-button text-bold"
            flat
            no-caps
            :disable="!newTokenName.trim() || loading"
            :label="t('common.create')"
            @click="createToken"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Revealed token dialog -->
    <q-dialog v-model="showRevealedDialog" persistent>
      <q-card
        :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
        style="width: 520px; max-width: 90vw"
      >
        <q-card-section class="row items-center q-pb-none">
          <span class="text-h6">{{ t("ingestion.newTokenRevealed") }}</span>
          <q-space />
          <q-btn flat round dense icon="close" @click="showRevealedDialog = false" />
        </q-card-section>
        <q-card-section>
          <div
            class="q-pa-sm tw:border tw:border-dashed tw:rounded tw:border-gray-400"
            :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-grey-2'"
          >
            <code
              :class="store.state.theme === 'dark' ? 'text-grey-3' : 'text-black'"
              class="tw:break-all tw:font-mono"
              style="font-size: 0.9rem"
            >{{ revealedToken?.token }}</code>
          </div>
          <div class="q-mt-sm text-caption text-warning">
            <q-icon name="info" size="16px" class="q-mr-xs" />
            {{ t("ingestion.copyTokenWarning") }}
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            flat
            no-caps
            icon="content_copy"
            :label="t('ingestion.copyTokenBtn')"
            @click="copyToken(revealedToken?.token || '')"
          />
          <q-btn
            flat
            no-caps
            :label="t('common.close')"
            @click="showRevealedDialog = false"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script lang="ts">
import { ref, computed, defineComponent, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useQuasar, copyToClipboard, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";
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
  setup() {
    const store = useStore();
    const $q = useQuasar();
    const { t } = useI18n();

    const tokens = ref<Token[]>([]);
    const loading = ref(false);
    const showCreateForm = ref(false);
    const showRevealedDialog = ref(false);
    const newTokenName = ref("");
    const newTokenDescription = ref("");
    const revealedToken = ref<{ name: string; token: string } | null>(null);

    const pagination = ref({
      rowsPerPage: 0,
    });

    const columns: QTableProps["columns"] = [
      {
        name: "name",
        field: "name",
        label: t("ingestion.tokenNameLabel"),
        align: "left",
        sortable: true,
      },
      {
        name: "token",
        field: "token",
        label: t("serviceAccounts.token"),
        align: "left",
        sortable: false,
        style: "width: 300px;",
      },
      {
        name: "created_by",
        field: "created_by",
        label: t("ingestion.createdBy"),
        align: "left",
        sortable: true,
        style: "width: 200px;",
      },
      {
        name: "actions",
        field: "actions",
        label: t("common.actions"),
        align: "center",
        sortable: false,
        classes: "actions-column",
        style: "width: 120px;",
      },
    ];

    const isAdmin = computed(() => {
      const role = store.state.userInfo?.role;
      return role === "admin" || role === "root";
    });

    const fetchTokens = async () => {
      loading.value = true;
      try {
        const res = await organizationsService.list_org_ingestion_tokens(
          store.state.selectedOrganization.identifier,
        );
        tokens.value = res.data.data;
      } catch (e: any) {
        $q.notify({
          type: "negative",
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
        $q.notify({
          type: "positive",
          message: t("ingestion.tokenCreatedSuccess"),
          timeout: 5000,
        });
      } catch (e: any) {
        $q.notify({
          type: "negative",
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
        $q.notify({
          type: "positive",
          message: `Token ${enabled ? "enabled" : "disabled"} successfully.`,
          timeout: 3000,
        });
      } catch (e: any) {
        $q.notify({
          type: "negative",
          message: e.response?.data?.message || "Failed to update token.",
          timeout: 5000,
        });
      } finally {
        loading.value = false;
      }
    };

    const copyToken = (token: string) => {
      copyToClipboard(token).then(() => {
        $q.notify({
          type: "positive",
          message: t("common.copied") || "Copied!",
          timeout: 3000,
        });
      });
    };

    const downloadToken = (token: string) => {
      const blob = new Blob([token], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "org_ingestion_token.txt";
      link.click();
      URL.revokeObjectURL(link.href);
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
      pagination,
      showCreateForm,
      showRevealedDialog,
      newTokenName,
      newTokenDescription,
      revealedToken,
      isAdmin,
      fetchTokens,
      createToken,
      toggleEnabled,
      copyToken,
      downloadToken,
    };
  },
});
</script>
