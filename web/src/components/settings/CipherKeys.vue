<!-- Copyright 2023 OpenObserve Inc.

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

<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <q-page class="q-pa-none" style="min-height: inherit;">
    <div v-if="!showAddDialog" style="height: calc(100vh - 112px); overflow-y: auto;">
      <div class="tw-flex tw-justify-between tw-items-center tw-px-4 tw-py-3"
      :class="store.state.theme == 'dark' ? 'o2-table-header-dark' : 'o2-table-header-light'"
      >
            <div
              class="col q-table__title items-start"
              data-test="cipher-keys-list-title"
            >
              {{ t("cipherKey.header") }}
            </div>
            <div class="col-auto flex">
              <q-input
                v-model="filterQuery"
                filled
                dense
                class="q-ml-none q-mb-xs"
                style="width: 400px"
                :placeholder="t('cipherKey.search')"
                clearable
              >
                <template #prepend>
                  <q-icon name="search" />
                </template>
              </q-input>
              <q-btn
                class="q-mb-xs text-bold no-border q-ml-md"
                padding="sm lg"
                color="secondary"
                no-caps
                dense
                :label="t(`cipherKey.add`)"
                @click="addCipherKey"
              />
            </div>
          </div>
      <q-table
        ref="qTable"
        :rows="tabledata"
        :columns="columns"
        row-key="id"
        :pagination="pagination"
        :filter="filterQuery"
        :filter-method="filterData"
        :loading="loading"
        class="o2-quasar-table"
        :class="store.state.theme == 'dark' ? 'o2-quasar-table-dark' : 'o2-quasar-table-light'"
      >
        <template #no-data><NoData /></template>
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              :data-test="`cipherkey-list-${props.row.name}-update`"
              icon="edit"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('common.edit')"
              @click="editCipherKey(props.row)"
            ></q-btn>
            <q-btn
              :data-test="`cipherkey-list-${props.row.name}-delete`"
              :icon="outlinedDelete"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('common.delete')"
              @click="confirmDeleteCipherKey(props.row)"
            ></q-btn>
          </q-td>
        </template>
        <template #top="scope">
          <div class="row full-width">
            <QTablePagination
              v-if="resultTotal > 0"
              :scope="scope"
              :pageTitle="t('cipherKey.header')"
              :resultTotal="resultTotal"
              :perPageOptions="perPageOptions"
              position="top"
              @update:changeRecordPerPage="changePagination"
            />
          </div>
        </template>

        <template #bottom="scope">
          <QTablePagination
            v-if="resultTotal > 0"
            :scope="scope"
            :resultTotal="resultTotal"
            :perPageOptions="perPageOptions"
            position="bottom"
            @update:changeRecordPerPage="changePagination"
          />
        </template>
        <template v-slot:header="props">
            <q-tr :props="props">
              <!-- Render the table headers -->
              <q-th
                v-for="col in props.cols"
                :key="col.name"
                :props="props"
                :class="col.classes"
                :style="col.style"
              >
                {{ col.label }}
              </q-th>
            </q-tr>
          </template>
      </q-table>
    </div>
    <div v-else>
      <add-cipher-key @cancel:hideform="hideAddDialog" />
    </div>
  </q-page>
  <ConfirmDialog
    title="Delete Cipher Key"
    message="Are you sure you want to delete Cipher Key?"
    @update:ok="deleteCipherKey"
    @update:cancel="cancelDeleteCipherKey"
    v-model="confirmDelete.visible"
  />
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onUpdated, watch, Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, date, copyToClipboard, QTableProps } from "quasar";
import { useI18n } from "vue-i18n";

import QTablePagination from "@/components/shared/grid/Pagination.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import segment from "@/services/segment_analytics";
import { convertToTitleCase } from "@/utils/zincutils";
import config from "@/aws-exports";
import AddCipherKey from "@/components/cipherkeys/AddCipherKey.vue";
import CipherKeysService from "@/services/cipher_keys";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

export default defineComponent({
  name: "PageCipherKeys",
  components: {
    QTablePagination,
    NoData,
    AddCipherKey,
    ConfirmDialog,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const tabledata: any = ref([]);
    const showAddDialog = ref(false);
    const qTable: any = ref(null);
    const loading = ref(false);
    const columns = ref<QTableProps["columns"]>([
      {
        name: "#",
        label: "#",
        field: "#",
        align: "left",
        style: "width: 67px",
      },
      {
        name: "name",
        field: "name",
        label: t("cipherKey.name"),
        align: "left",
        sortable: true,
      },
      {
        name: "store_type",
        field: "store_type",
        label: t("cipherKey.storeType"),
        align: "left",
        sortable: true,
        style: "width: 150px",
      },
      {
        name: "mechanism_type",
        field: "mechanism_type",
        label: t("cipherKey.mechanismType"),
        align: "left",
        sortable: true,
        style: "width: 150px",
      },
      {
        name: "actions",
        field: "actions",
        label: t("cipherKey.actions"),
        align: "left",
        sortable: false,
        classes:'actions-column'
      },
    ]);
    const perPageOptions = [
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "250", value: 250 },
      { label: "500", value: 500 },
    ];
    const resultTotal = ref<number>(0);
    const maxRecordToReturn = ref<number>(100);
    const selectedPerPage = ref<number>(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });

    const confirmDelete: Ref<{
      visible: boolean;
      data: any;
    }> = ref({ visible: false, data: null });

    watch(
      () => router.currentRoute.value.query?.action,
      (action) => {
        if (action == "add" || action == "edit") {
          showAddDialog.value = true;
        }
      },
    );

    onMounted(() => {
      if (
        router.currentRoute.value.query.action == "add" ||
        router.currentRoute.value.query.action == "edit"
      ) {
        showAddDialog.value = true;
      }
    });

    onUpdated(() => {
      if (
        router.currentRoute.value.query.action == "add" ||
        router.currentRoute.value.query.action == "edit"
      ) {
        showAddDialog.value = true;
      } else {
        showAddDialog.value = false;
      }
    });

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };

    const addCipherKey = (evt: any) => {
      router.push({
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const editCipherKey = (data: any) => {
      router.push({
        query: {
          action: "edit",
          org_identifier: store.state.selectedOrganization.identifier,
          name: data.name,
        },
      });
    };

    const getData = () => {
      loading.value = true;
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading data...",
      });

      CipherKeysService.list(store.state.selectedOrganization.identifier)
        .then((response) => {
          const data = [];
          const responseData = response.data.keys;
          for (let i = 0; i < responseData.length; i++) {
            data.push({
              "#": i + 1,
              name: responseData[i].name,
              store_type: responseData[i].key.store.type,
              mechanism_type: responseData[i].key.mechanism.type,
            });
          }

          tabledata.value = data;
          resultTotal.value = responseData.length;
          loading.value = false;
          dismiss();
        })
        .catch((error) => {
          loading.value = false;
          dismiss();
          if (error.status != 403) {
            $q.notify({
              type: "negative",
              message:
                error.response?.data?.message ||
                "Failed to fetch cipher keys. Please try again.",
              timeout: 5000,
            });
          }
        });
    };

    getData();

    const hideAddDialog = async () => {
      showAddDialog.value = !showAddDialog.value;
      await getData();
      router.push({
        name: "cipherKeys",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const deleteCipherKey = () => {
      if (confirmDelete.value?.data?.name) {
        const dismiss = $q.notify({
          spinner: true,
          message: "Please wait while processing delete request...",
          type: "warning",
        });
        CipherKeysService.delete(
          store.state.selectedOrganization.identifier,
          confirmDelete.value.data.name,
        )
          .then(() => {
            dismiss();
            $q.notify({
              type: "positive",
              message: `Cipher Key deleted successfully`,
              timeout: 2000,
            });

            getData();
          })
          .catch((err) => {
            dismiss();
            if (err.response.data.code === 409) {
              $q.notify({
                type: "negative",
                message: err.response.data.message,
                timeout: 2000,
              });
            } else {
              if (err?.status != 403) {
                $q.notify({
                  type: "negative",
                  message: err.response.data.message,
                  timeout: 2000,
                });
              }
            }
          });
      }
    };
    const confirmDeleteCipherKey = (destination: any) => {
      confirmDelete.value.visible = true;
      confirmDelete.value.data = destination;
    };
    const cancelDeleteCipherKey = () => {
      confirmDelete.value.visible = false;
      confirmDelete.value.data = null;
    };

    return {
      t,
      store,
      router,
      qTable,
      loading,
      tabledata,
      columns,
      showAddDialog,
      addCipherKey,
      getData,
      pagination,
      resultTotal,
      perPageOptions,
      selectedPerPage,
      changePagination,
      maxRecordToReturn,
      filterQuery: ref(""),
      filterData(rows: string | any[], terms: string) {
        const filtered = [];
        terms = terms.toLowerCase();
        for (let i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      },
      hideAddDialog,
      cancelDeleteCipherKey,
      confirmDeleteCipherKey,
      confirmDelete,
      outlinedDelete,
      editCipherKey,
      deleteCipherKey,
    };
  },
});
</script>

<style lang="scss" scoped>
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}
</style>
