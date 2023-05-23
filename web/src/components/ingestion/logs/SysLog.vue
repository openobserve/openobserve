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
        v-model="syslogEnabled"
        :label="syslogEnabled ? 'Turn off' : 'Turn On'"
      />

      <div v-if="syslogEnabled" class="syslog-inputs row">
        <div class="col-12 flex justify-end">
          <q-btn
            :label="t('ingestion.syslog_addroute')"
            color="secondary"
            data-test="syslog-connect"
            class="q-mb-md q-mt-md text-bold no-border"
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
                      data-test="add-alert-name-input"
                      color="input-border"
                      bg-color="input-bg"
                      class="showLabelOnTop q-py-sm"
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
                      class="q-ml-xs iconHoverBtn"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      flat
                      :title="t('alerts.edit')"
                      @click="saveRoute(props.row)"
                    ></q-btn>
                    <q-btn
                      :data-test="`alert-list-${props.row.name}-delete-alert`"
                      icon="cancel"
                      class="q-ml-xs iconHoverBtn"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      flat
                      :title="t('alerts.delete')"
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
                      class="q-ml-xs iconHoverBtn"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      flat
                      :title="t('alerts.edit')"
                      @click="editRoute(props.row)"
                    ></q-btn>
                    <q-btn
                      :data-test="`alert-list-${props.row.name}-delete-alert`"
                      :icon="
                        'img:' + getImageURL('images/common/delete_icon.svg')
                      "
                      class="q-ml-xs iconHoverBtn"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      flat
                      :title="t('alerts.delete')"
                      @click="deleteRoute(props.row)"
                    ></q-btn>
                  </template>
                </q-td>
              </template>
            </q-tr>
            <!-- <q-tr
            v-show="editingRoute.id == props.row.id"
            :props="props"
            no-hover
            style="
              height: min-content;
              background-color: white;
              border: 1px solid black;
            "
          >
            <q-td colspan="100%">
              <div
                v-show="loadingFunctions == props.row.name"
                class="q-pl-md q-py-xs"
                style="height: 60px"
              >
                <q-inner-loading
                  size="sm"
                  :showing="loadingFunctions == props.row.name"
                  label="Fetching functions..."
                  label-style="font-size: 1.1em"
                />
              </div>
              <div v-show="loadingFunctions != props.row.name"></div>
            </q-td>
          </q-tr> -->
          </template>

          <!-- <template #top="scope">
          <div class="q-table__title" data-test="log-stream-title-text">
            {{ t("logStream.header") }}
          </div>
          <q-input
            v-model="filterQuery"
            borderless
            filled
            dense
            class="q-ml-auto q-mb-xs no-border"
            :placeholder="t('logStream.search')"
          >
            <template #prepend>
              <q-icon name="search" />
            </template>
          </q-input>
          <q-btn
            data-test="log-stream-refresh-stats-btn"
            class="q-ml-md q-mb-xs text-bold no-border"
            padding="sm lg"
            color="secondary"
            no-caps
            icon="refresh"
            :label="t(`logStream.refreshStats`)"
            @click="getLogStream"
          />

          <QTablePagination
            data-test="log-stream-table-pagination"
            :scope="scope"
            :pageTitle="t('logStream.header')"
            :resultTotal="resultTotal"
            :perPageOptions="perPageOptions"
            position="top"
            @update:changeRecordPerPage="changePagination"
          />
        </template>

        <template #bottom="scope">
          <QTablePagination
            data-test="log-stream-table-pagination"
            :scope="scope"
            :resultTotal="resultTotal"
            :perPageOptions="perPageOptions"
            position="bottom"
            @update:changeRecordPerPage="changePagination"
          />
        </template> -->
        </q-table>
        <!-- <div class="row flex justify-end">
          <q-btn
            data-test="syslog-delete-route"
            icon="edit"
            class="q-ml-xs iconHoverBtn"
            unelevated
            size="sm"
            round
            flat
            :title="t('ingestion.deleteRoute')"
            @click="deleteRoute"
          />
          <q-btn
            data-test="syslog-delete-route"
            icon="delete"
            class="q-ml-xs iconHoverBtn"
            unelevated
            size="sm"
            round
            flat
            :title="t('ingestion.deleteRoute')"
            @click="deleteRoute"
          />
        </div>
        <q-select
          data-test="syslog-select-stream"
          v-model="editingRoute.orgId"
          :label="t('ingestion.organization')"
          :options="organizations"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          :rules="[(val: any) => !!val || 'Field is required!']"
          tabindex="0"
        />
        <q-input
          data-test="syslog-select-stream"
          v-model="editingRoute.streamName"
          :label="t('ingestion.stream')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          :rules="[(val: any) => !!val || 'Field is required!']"
          tabindex="0"
        />
        <div class="q-pt-xs">
          <div class="text-bold">Subnets</div>
          <q-input
            v-model="editingRoute.subnets"
            data-test="add-alert-name-input"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop q-pb-none"
            stack-label
            outlined
            filled
            dense
            :rules="[(val: any) => !!val || 'Field is required!']"
          />
        </div>
        <q-btn
          :label="t('alerts.save')"
          color="secondary"
          data-test="syslog-connect"
          class="q-mb-md q-mt-md text-bold no-border"
          padding="sm xl"
          type="submit"
          no-caps
          @click="connect"
        />
        <q-btn
          :label="t('alerts.save')"
          color="secondary"
          data-test="syslog-connect"
          class="q-mb-md q-mt-md text-bold no-border"
          padding="sm xl"
          type="submit"
          no-caps
          @click="connect"
        /> -->
      </div>
    </div>
  </div>
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
import type { QTableProps } from "quasar";

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
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const syslogEnabled = ref(false);
    const organization = ref("");
    const isLoading = ref(false);
    const routeList: Ref<SyslogRoute[]> = ref([]);
    const organizations = ref([]);

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
        style: "width: 30px",
      },
      {
        name: "orgId",
        field: "orgId",
        label: t("ingestion.organization"),
        align: "left",
        sortable: true,
        style: "width: 150px",
      },
      {
        name: "streamName",
        field: "streamName",
        label: t("ingestion.stream"),
        align: "left",
        sortable: true,
        style: "width: 150px",
      },
      {
        name: "subnets",
        field: "subnets",
        label: t("ingestion.subnets"),
        align: "left",
        sortable: true,
        style: "width: auto",
      },
      {
        name: "actions",
        field: "actions",
        label: t("user.actions"),
        align: "center",
        style: "width: 100px",
      },
    ]);
    const toggleSyslog = () => {
      syslogService
        .toggle(organization.value, { state: syslogEnabled.value })
        .then((res) =>
          store.dispatch("setConfig", {
            ...store.state.zoConfig,
            syslog_enabled: res.data,
          })
        );
    };

    const saveRoute = () => {
      if (editingRoute.value.isSaved) updateRoute();
      else createRoute();
    };

    const createRoute = () => {
      const payload = getRoutePayload();
      syslogService.create(organization.value, payload).then((res) => {
        resetEditingRoute();
        getSyslogRoutes();
      });
    };

    const updateRoute = () => {
      const payload = getRoutePayload();
      console.log(payload);
      syslogService
        .update(organization.value, editingRoute.value?.id || "", payload)
        .then(() => {
          resetEditingRoute();
          getSyslogRoutes();
        });
    };

    const updateExistingRoute = (route: SyslogRoute) => {
      routeList.value.map((_route) => {
        if (route.id === _route.id) {
          return cloneDeep({ ...route, "#": editRoute });
        }
      });
    };

    const getRoutePayload = () => {
      const payload: any = {
        orgId: editingRoute.value.orgId,
        streamName: editingRoute.value.streamName,
        subnets: editingRoute.value.subnets.split(","),
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

    const addSubnet = (value: string = "") => {
      editingRoute.value.subnets.push({ value: value, uuid: getUUID() });
    };

    const deleteSubnet = (subnet: any) => {
      editingRoute.value.subnets = editingRoute.value.subnets.filter(
        (_subnet: any) => _subnet.uuid !== subnet.uuid
      );

      if (!editingRoute.value.subnets.length) addSubnet();
    };

    const getSyslogRoutes = () => {
      syslogService.list(organization.value).then((response: any) => {
        routeList.value = response.data.routes.map(
          (route: any, index: number) => ({
            ...route,
            "#": index + 1,
            isSaved: true,
          })
        );
      });
    };

    const deleteRoute = (route: any) => {
      if (!route.isSaved) {
        routeList.value = routeList.value
          .filter((_route) => route.id !== _route.id)
          .map((route, index) => ({ ...route, "#": index + 1 }));
        return;
      }
      syslogService
        .delete(editingRoute.value.orgId, route.id || "")
        .then(() => getSyslogRoutes());
    };

    const resetEditingRoute = () => {
      editingRoute.value = getDefaultRoute();
    };

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
      }
    });

    watch(
      () => store.state.zoConfig.syslog_enabled,
      (value) => {
        if (store.state.zoConfig.syslog_enabled !== undefined) {
          isLoading.value = false;
          syslogEnabled.value = value;
        }
      },
      {
        deep: true,
        immediate: true,
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

    const editRoute = (route: any) => {
      editingRoute.value = cloneDeep({
        ...route,
        subnets: route.subnets.join(","),
      });
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

    return {
      t,
      syslogEnabled,
      editingRoute,
      toggleSyslog,
      getImageURL,
      deleteSubnet,
      addSubnet,
      isLoading,
      organizations,
      deleteRoute,
      routeList,
      columns,
      editRoute,
      addNewRoute,
      saveRoute,
      resetEditingRoute,
    };
  },
});
</script>

<style scoped lang="scss">
.tabContent {
  background-color: $accent; // tab content bg color
  padding: 1rem;
  border-radius: 0.5rem;
  .title {
    text-transform: uppercase;
    font-size: 0.75rem;
    color: $dark-page;
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
    padding: 7px 8px !important;
  }
}
</style>
