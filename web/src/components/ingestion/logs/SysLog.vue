<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div class="tabContent q-ma-md">
    <div class="title" data-test="syslog-title-text">Syslog</div>
    <div v-if="isLoading" class="flex column items-center justify-center">
      <q-spinner color="primary" size="lg" />
      <div>Loading Syslog</div>
    </div>
    <div v-else>
      <q-toggle
        :disable="disableToggle"
        class="q-mt-sm"
        v-model="syslogEnabled"
        :label="syslogEnabled ? t('syslog.off') : t('syslog.on')"
      />

      <div v-if="syslogEnabled" class="syslog-inputs row">
        <div class="col-12 flex justify-end">
          <q-btn
            :label="t('syslog.syslog_addroute')"
            color="secondary"
            data-test="syslog-connect"
            class="q-mb-md text-bold no-border"
            padding="sm xl"
            type="submit"
            no-caps
            @click="addNewRoute"
          />
        </div>

        <q-table
          data-test="log-stream-table"
          ref="qTable"
          :rows="routeList"
          :columns="columns"
          row-key="id"
          style="width: 100%"
          class="syslog-table"
        >
          <template #no-data>
            <div class="text-center col-12">No routes present</div>
          </template>
          <template v-slot:header="props">
            <q-tr :props="props">
              <q-th v-for="col in props.cols" :key="col.name" :props="props">
                {{ col.label }}
              </q-th>
            </q-tr>
          </template>
          <template v-slot:body="props">
            <q-tr :props="props" style="cursor: pointer">
              <template v-if="props.row.id === editingRoute.id">
                <q-td v-for="col in props.cols" :key="col.name" :props="props">
                  <template v-if="col.name === 'orgId'">
                    <q-select
                      data-test="syslog-select-stream"
                      v-model="editingRoute.orgId"
                      :options="organizations"
                      color="input-border"
                      bg-color="input-bg"
                      class="showLabelOnTop q-py-sm"
                      stack-label
                      outlined
                      filled
                      dense
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      tabindex="0"
                    />
                  </template>
                  <template v-else-if="col.name === 'streamName'">
                    <q-input
                      data-test="syslog-select-stream"
                      v-model="editingRoute.streamName"
                      color="input-border"
                      bg-color="input-bg"
                      class="showLabelOnTop q-py-sm"
                      stack-label
                      outlined
                      filled
                      dense
                      :rules="[(val: any) => !!val || 'Field is required!']"
                  /></template>
                  <template v-else-if="col.name === 'subnets'">
                    <q-input
                      v-model="editingRoute.subnets"
                      label="Enter multiple subnets separated by commas"
                      data-test="add-alert-name-input"
                      placeholder="192.168.1.0/24, 10.0.0.0/16"
                      color="input-border"
                      bg-color="input-bg"
                      class="showLabelOnTop subnets-input q-py-sm"
                      stack-label
                      outlined
                      filled
                      dense
                      :rules="[(val: any) => !!val || 'Field is required!']"
                    />
                  </template>
                  <template v-else-if="col.name === 'actions'">
                    <q-btn
                      :data-test="`alert-list-${props.row.name}-udpate-alert`"
                      icon="save"
                      class="q-ml-xs"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      flat
                      :title="t('syslog.edit')"
                      @click="saveEditingRoute"
                    ></q-btn>
                    <q-btn
                      :data-test="`alert-list-${props.row.name}-delete-alert`"
                      icon="cancel"
                      class="q-ml-xs"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      flat
                      :title="t('syslog.cancel')"
                      @click="resetEditingRoute"
                    ></q-btn>
                  </template>
                  <template v-else>
                    {{ col.value }}
                  </template>
                </q-td>
              </template>
              <template v-else>
                <q-td v-for="col in props.cols" :key="col.name" :props="props">
                  {{ col.value }}
                  <template v-if="col.name === 'actions'">
                    <q-btn
                      :data-test="`alert-list-${props.row.name}-udpate-alert`"
                      icon="edit"
                      class="q-ml-xs"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      flat
                      :title="t('syslog.edit')"
                      @click="editRoute(props.row)"
                    ></q-btn>
                    <q-btn
                      :data-test="`alert-list-${props.row.name}-delete-alert`"
                      :icon="outlinedDelete" color="red"
                      class="q-ml-xs"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      flat
                      :title="t('syslog.delete')"
                      @click="conformDeleteRoute(props.row)"
                    ></q-btn>
                  </template>
                </q-td>
              </template>
            </q-tr>
          </template>
        </q-table>
      </div>
    </div>
  </div>
  <ConfirmDialog
    title="Delete Alert"
    message="Are you sure you want to delete route?"
    @update:ok="deleteRoute"
    @update:cancel="cancelDeleteRoute"
    v-model="showConformDelete"
  />
</template>

<script lang="ts">
import {
  defineComponent,
  onBeforeMount,
  ref,
  watch,
  type Ref,
  onMounted,
} from "vue";
import { getImageURL } from "../../../utils/zincutils";
import { useI18n } from "vue-i18n";
import syslogService from "@/services/syslog";
import { useStore } from "vuex";
import { cloneDeep } from "lodash-es";
import { useQuasar, type QTableProps } from "quasar";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { outlinedDelete } from '@quasar/extras/material-icons-outlined'

interface SyslogRoute {
  orgId: string;
  streamName: string;
  subnets: string;
  id?: string;
  isSaved?: boolean;
}

export default defineComponent({
  name: "SysLog",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
  },
  components: { ConfirmDialog },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const syslogEnabled = ref(false);
    const organization = ref("");
    const isLoading = ref(false);
    const routeList: Ref<SyslogRoute[]> = ref([]);
    const organizations = ref([]);
    const q = useQuasar();
    const disableToggle = ref(false);

    const showConformDelete = ref(false);
    const routeToDelete: Ref<SyslogRoute | null> = ref(null);

    const editingRoute: Ref<SyslogRoute> = ref({
      orgId: "",
      streamName: "",
      subnets: "",
    });

    const columns = ref<QTableProps["columns"]>([
      {
        name: "#",
        label: "#",
        field: "#",
        align: "left",
        style: "width: 8%",
      },
      {
        name: "orgId",
        field: "orgId",
        label: t("syslog.organization"),
        align: "left",
        sortable: true,
        style: "width: 20%",
      },
      {
        name: "streamName",
        field: "streamName",
        label: t("syslog.stream"),
        align: "left",
        sortable: true,
        style: "width: 20%",
      },
      {
        name: "subnets",
        field: "subnets",
        label: t("syslog.subnets"),
        align: "left",
        sortable: true,
        style: "width: 40%",
      },
      {
        name: "actions",
        field: "actions",
        label: t("user.actions"),
        align: "center",
        style: "width: 12%",
      },
    ]);

    onBeforeMount(() => {
      isLoading.value = true;
      organization.value = store.state.selectedOrganization.identifier;
      organizations.value = store.state.organizations.map(
        (org: any) => org.name
      );
      getSyslogRoutes();
    });

    onMounted(() => {
      if (store.state.zoConfig.syslog_enabled !== undefined) {
        isLoading.value = false;
        syslogEnabled.value = store.state.zoConfig.syslog_enabled;
      }
    });

    watch(
      () => store.state.zoConfig.syslog_enabled,
      (value) => {
        if (store.state.zoConfig.syslog_enabled !== undefined) {
          isLoading.value = false;
          syslogEnabled.value = value;
        }
      }
    );

    watch(
      () => store.state.organizations,
      (orgs) => {
        if (orgs.length) {
          organizations.value = orgs.map((org: any) => org.identifier);
        }
      },
      {
        deep: true,
        immediate: true,
      }
    );

    watch(syslogEnabled, () => {
      toggleSyslog();
    });

    const toggleSyslog = () => {
      const dismiss = q.notify({
        spinner: true,
        message: `Please wait while turning ${
          syslogEnabled.value ? "On" : "Off"
        } syslog...`,
      });
      disableToggle.value = true;
      syslogService
        .toggle(organization.value, { state: syslogEnabled.value })
        .then((res) =>
          store.dispatch("setConfig", {
            ...store.state.zoConfig,
            syslog_enabled: res.data,
          })
        )
        .finally(() => {
          disableToggle.value = false;
          dismiss();
        });
    };

    const saveEditingRoute = () => {
      if (editingRoute.value.isSaved) updateRoute();
      else createRoute();
    };

    const createRoute = () => {
      const payload = getRoutePayload();
      const dismiss = q.notify({
        spinner: true,
        message: "Please wait while saving route...",
      });
      syslogService
        .create(organization.value, payload)
        .then(() => {
          resetEditingRoute();
          getSyslogRoutes();
          q.notify({
            message: "Route saved successfully",
            type: "positive",
            timeout: 2000,
          });
        })
        .catch((err) => {
          let errorMessage = "";
          if (err.response?.data?.message) {
            errorMessage = err.response?.data?.message;
          } else if (err.response?.data) {
            errorMessage = err.response?.data;
          }
          q.notify({
            message: `Error while saving route ${
              typeof errorMessage === "string" ? `( ${errorMessage} )` : ""
            }`,
            type: "negative",
            timeout: 4000,
          });
        })
        .finally(() => dismiss());
    };

    const updateRoute = () => {
      const payload = getRoutePayload();
      const dismiss = q.notify({
        spinner: true,
        message: "Please wait while saving route...",
      });
      syslogService
        .update(organization.value, editingRoute.value?.id || "", payload)
        .then(() => {
          resetEditingRoute();
          getSyslogRoutes();
          q.notify({
            message: "Route saved successfully",
            type: "positive",
            timeout: 2000,
          });
        })
        .catch((err) => {
          let errorMessage = "";
          if (err.response?.data?.message) {
            errorMessage = err.response?.data?.message;
          } else if (err.response?.data) {
            errorMessage = err.response?.data;
          }
          q.notify({
            message: `Error while saving route ${
              typeof errorMessage === "string" ? `( ${errorMessage} )` : ""
            }`,
            type: "negative",
            timeout: 4000,
          });
        })
        .finally(() => dismiss());
    };

    const getRoutePayload = () => {
      const payload: any = {
        orgId: editingRoute.value.orgId,
        streamName: editingRoute.value.streamName,
        subnets: editingRoute.value.subnets
          .split(",")
          .map((subnet) => subnet.trim()),
      };
      if (editingRoute.value.id) payload["id"] = editingRoute.value.id;
      return payload;
    };

    // TODO OK: Use UUID package instead of this and move this method in utils
    const getUUID = () => {
      return (
        Math.floor(Math.random() * (9999999999 - 100 + 1)) + 100
      ).toString();
    };

    const getSyslogRoutes = () => {
      const dismiss = q.notify({
        spinner: true,
        message: "Please wait while loading route...",
      });
      syslogService
        .list(organization.value)
        .then((response: any) => {
          routeList.value = response.data.routes.map(
            (route: any, index: number) => ({
              ...route,
              "#": index + 1,
              isSaved: true,
              subnets: route.subnets.join(", "),
            })
          );
        })
        .catch((err) => {
          let errorMessage = "";
          if (err.response?.data?.message) {
            errorMessage = err.response?.data?.message;
          } else if (err.response?.data) {
            errorMessage = err.response?.data;
          }
          q.notify({
            message: `Error while getting routes ${
              typeof errorMessage === "string" ? `( ${errorMessage} )` : ""
            }`,
            type: "negative",
            timeout: 3000,
          });
        })
        .finally(() => dismiss());
    };

    const deleteRoute = () => {
      if (!routeToDelete.value) return;

      if (!routeToDelete.value?.isSaved) {
        routeList.value = routeList.value
          .filter((_route) => routeToDelete.value?.id !== _route.id)
          .map((route, index) => ({ ...route, "#": index + 1 }));
        return;
      }

      const dismiss = q.notify({
        spinner: true,
        message: "Please wait while deleting route...",
      });
      syslogService
        .delete(organization.value, routeToDelete.value.id || "")
        .then(() => {
          getSyslogRoutes();
          q.notify({
            message: "Route deleted successfully",
            type: "positive",
            timeout: 2000,
          });
        })
        .catch((err) => {
          let errorMessage = "";
          if (err.response?.data?.message) {
            errorMessage = err.response?.data?.message;
          } else if (err.response?.data) {
            errorMessage = err.response?.data;
          }
          q.notify({
            message: `Error while deleting route ${
              typeof errorMessage === "string" ? `( ${errorMessage} )` : ""
            }`,
            type: "negative",
            timeout: 3000,
          });
        })
        .finally(() => dismiss());
    };

    const resetEditingRoute = () => {
      editingRoute.value = getDefaultRoute();
    };

    const editRoute = (route: any) => {
      editingRoute.value = cloneDeep(route);
    };

    const getDefaultRoute = () => {
      return {
        "#": routeList.value.length + 1,
        orgId: organizations.value[0],
        streamName: "default",
        subnets: "",
        id: getUUID(),
      };
    };

    const addNewRoute = () => {
      routeList.value.push(getDefaultRoute());
      editingRoute.value = routeList.value[routeList.value.length - 1];
    };

    const conformDeleteRoute = (route: SyslogRoute) => {
      showConformDelete.value = true;
      routeToDelete.value = route;
    };

    const cancelDeleteRoute = () => {
      showConformDelete.value = false;
      routeToDelete.value = null;
    };

    return {
      t,
      syslogEnabled,
      editingRoute,
      toggleSyslog,
      getImageURL,
      isLoading,
      organizations,
      deleteRoute,
      routeList,
      columns,
      editRoute,
      addNewRoute,
      saveEditingRoute,
      resetEditingRoute,
      conformDeleteRoute,
      showConformDelete,
      cancelDeleteRoute,
      disableToggle,
      outlinedDelete,
    };
  },
});
</script>

<style scoped lang="scss">
.tabContent {
  background-color: rgba(136, 136, 136, 0.103);
 // tab content bg color
  padding: 1rem;
  border-radius: 0.5rem;
  .title {
    text-transform: uppercase;
    font-size: 0.75rem;
    line-height: 1rem;
    font-weight: 600;
  }
}
</style>

<style lang="scss">
.syslog-inputs {
  .q-field__bottom {
    padding: 2px 0px 0px 0px !important;
  }
}
.syslog-table {
  .q-table td,
  .q-table th {
    padding: 10px 10px !important;
  }

  .q-field--labeled.showLabelOnTop {
    &.subnets-input {
      padding-top: 8px !important;

      .q-field__label {
        font-size: 12px;
        top: 15px;
        font-weight: normal;
      }
    }
  }
}
</style>
