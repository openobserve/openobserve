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
<!-- TODO: we need to completely remove the store.state.theme based styling on this page as we have moved it to central place app.scss -->
<template>
  <q-page
    class="quota-page text-left card-container"
    :class="
      store.state.theme === 'dark' ? 'dark-theme-page' : 'light-theme-page'
    "
    style="min-height: inherit"
  >
    <div :style="{ height: '100%', marginTop: 0 }" class="app-table-container">
      <div class="card-container tw:mb-[0.625rem]">
        <div class="q-px-md q-py-sm">
          <div
            class="q-table__title full-width q-pb-sm"
            data-test="user-title-text"
          >
            {{ t("quota.header") }}
          </div>
          <div class="flex items-center justify-between full-width q-mb-sm">
            <div class="flex items-center">
              <q-select
                :loading="isOrgLoading"
                v-model="selectedOrganization"
                :options="organizationToDisplay"
                @filter="filterOrganizations"
                placeholder="Select Organization"
                :popup-content-style="{ textTransform: 'lowercase' }"
                color="input-border"
                bg-color="input-bg"
                class="q-py-sm no-case q-mr-md input-width org-select"
                stack-label
                outlined
                filled
                dense
                use-input
                hide-selected
                fill-input
                @update:model-value="updateOrganization()"
                :rules="[(val: any) => !!val || 'Field is required!']"
              >
              </q-select>
              <div class="app-tabs-container tw:h-[36px] tw:w-fit">
                <app-tabs
                  data-test="quota-tabs"
                  class="tabs-selection-container"
                  :tabs="tabs"
                  v-model:active-tab="activeTab"
                  @update:active-tab="updateActiveTab"
                />
              </div>
            </div>
            <div class="flex items-center" v-if="selectedOrganization">
              <q-btn
                v-if="!editTable"
                data-test="edit-table-btn"
                label="Edit Quota"
                flat
                class="border title-height o2-secondary-button tw:h-[36px]"
                :class="store.state.theme == 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                no-caps
                :disable="activeTab == 'role-limits' && !expandedRow"
                @click="editTableWithInput"
              >
                <q-icon
                  name="edit"
                  style="font-weight: 200; opacity: 0.7"
                  class="q-ml-sm"
                />
              </q-btn>
            </div>
          </div>
          <div class="flex items-center justify-between full-width q-mb-sm">
            <div
              v-if="selectedOrganization && activeType == 'table'"
              class="flex items-center"
            >
              <q-input
                data-test="pipeline-list-search-input"
                v-model="searchQuery"
                borderless
                flat
                class="no-border input-width o2-search-input"
                :class="store.state.theme == 'dark' ? 'o2-search-input-dark' : 'o2-search-input-light'"
                :placeholder="
                  {
                    'api-limits': t('quota.api-search'),
                    'role-limits': t('quota.role-search'),
                  }[activeTab]
                "

              >
                <template #prepend>
                  <q-icon name="search" class="cursor-pointer o2-search-input-icon" :class="store.state.theme == 'dark' ? 'o2-search-input-icon-dark' : 'o2-search-input-icon-light'" />
                </template>
              </q-input>
              <q-select
                v-if="activeTab == 'role-limits'"
                :loading="isApiCategoryLoading"
                v-model="selectedApiCategory"
                :options="filteredApiCategoryToDisplayOptions"
                placeholder="Select API Category"
                color="input-border"
                style="padding: 0px"
                bg-color="input-bg"
                class="no-case q-mr-md input-width q-ml-md category-select"
                stack-label
                outlined
                filled
                dense
                use-input
                hide-selected
                fill-input
                clearable
                @filter="filterApiCategoriesToDisplayOptions"
                @update:model-value="filterModulesBasedOnCategory()"
              >
              </q-select>
            </div>
            <div
              v-if="selectedOrganization"
              class="flex items-center float-right q-ml-auto"
            >
              <div class="app-tabs-container tw:h-[36px] tw:w-fit q-mr-md">
                <app-tabs
                  data-test="time-unit-tabs"
                  class="tabs-selection-container"
                  :tabs="timeUnitTabs"
                  v-model:active-tab="activeTimeUnit"
                  @update:active-tab="updateTimeUnit"
                />
              </div>
              <div class="app-tabs-container tw:h-[36px] tw:w-fit">
                <app-tabs
                  data-test="table-json-type-selection-tabs"
                  class="tabs-selection-container"
                  :tabs="typeTabs"
                  v-model:active-tab="activeType"
                  @update:active-tab="updateActiveType"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- this table for api limits -->
      <div v-if="activeTab == 'api-limits' && activeType == 'table' && !isApiLimitsLoading" class="card-container tw:h-[calc(100vh-218px)]">
      <q-table
        :rows="apiLimitsRows"
        :columns="generateColumns()"
        row-key="name"
        :class="store.state.theme == 'dark' ? 'o2-last-row-border-dark' : 'o2-last-row-border-light'"
        :pagination="pagination"
        :filter="searchQuery"
        :filter-method="filteredData"
        v-if="activeTab == 'api-limits' && activeType == 'table' && !isApiLimitsLoading"
        style="height: calc(100vh - 220px);"
        dense
      >
        <template v-slot:header="props">
          <q-tr :props="props" class="thead-sticky">
            <q-th
              v-for="col in props.cols"
              :key="col.name"
              :props="props"
              :style="col.style"
            >
              {{ col.label }}
            </q-th>
          </q-tr>
        </template>
        <template #no-data>
        </template>

        <template #bottom="scope">
          <q-table-pagination
            :scope="scope"
            :resultTotal="resultTotal"
            position="bottom"
            :perPageOptions="perPageOptions"
            @update:changeRecordPerPage="changePagination"
          />
        </template>

        <template v-slot:body-cell="props">
          <q-td
            :props="props"
            v-if="editTable"
            :style="{
              backgroundColor:
                editTable && props.col.name !== 'module_name'
                  ? store.state.theme === 'dark'
                    ? '#212121'
                    : '#f1f1ee'
                  : 'transparent',
            }"
          >
            <div
              v-if="
                props.col.name != 'module_name' &&
                props.row[props.col.name] != '-'
              "
              contenteditable="true"
              debounce="500"
              :class="{
                'editable-cell': editTable && props.col.name !== 'module_name',
                'edited-input': isEdited(props.row.module_name, props.col.name),
              }"
              @input="
                (event: any) =>
                  handleInputChange(
                    '',
                    props.row.module_name,
                    props.row[props.col.name],
                    props.col.name,
                    event.target.innerText,
                  )
              "
              @keypress="restrictToNumbers"
              @paste="preventNonNumericPaste"
            >
              {{
                changedValues[props.row.module_name]?.[props.col.name] ??
                props.row[props.col.name]
              }}
            </div>
            <div v-else-if="props.col.name == 'module_name'">
              {{ props.row[props.col.name] }}
            </div>
            <div :disabled="true" v-else-if="props.row[props.col.name] == '-'">
              -
            </div>
          </q-td>
          <q-td :props="props" v-else>
            <div
              v-if="
                props.col.name != 'module_name' &&
                props.row[props.col.name] != '-'
              "
            >
              {{ props.row[props.col.name] }}
            </div>
            <div v-else-if="props.col.name == 'module_name'">
              {{ props.row[props.col.name] }}
            </div>
            <div v-else-if="props.row[props.col.name] == '-'">-</div>
          </q-td>
        </template>
      </q-table>
      </div>

      <div v-if="isApiLimitsLoading && activeTab == 'api-limits' && activeType == 'table'" class="tw:h-[50vh] tw:flex tw:justify-center tw:items-center">
        <q-spinner-hourglass color="primary" size="lg" />
      </div>
      <div
        class="card-container tw:pb-[0.625rem]"
        v-if="activeTab == 'api-limits' && activeType == 'json'"
        style="height: calc(100vh - 220px)"
      >
        <query-editor
          data-test="json-view-roles-editor"
          ref="queryEditorRef"
          editor-id="json-view-roles-editor"
          class="monaco-editor"
          :debounceTime="300"
          v-model:query="jsonStrToDisplay"
          language="json"
          style="height: 100%"
          :read-only="!editTable"
        />
      </div>
      <!-- this table for role limits -->
       <div v-if="activeTab == 'role-limits' && activeType == 'table' && !isRolesLoading"  class="card-container tw:h-[calc(100vh-218px)]">
        <q-table
          :rows="rolesLimitRows"
          :columns="roleLimitsColumns"
          row-key="name"
          :pagination="pagination"
          :filter="searchQuery"
          :filter-method="filteredData"
          dense
          v-if="activeTab == 'role-limits' && activeType == 'table' && !isRolesLoading"
          :class="store.state.theme == 'dark' ? 'o2-last-row-border-dark' : 'o2-last-row-border-light'"
          :style="rolesLimitRows.length > 0 ? 'height: calc(100vh - 218px)' : ''"
        >
        <template v-slot:header="props">
          <q-tr :props="props" class="thead-sticky">
            <q-th
              v-for="col in props.cols"
              :key="col.name"
              :props="props"
              :style="col.style"
            >
              {{ col.label }}
            </q-th>
          </q-tr>
        </template>
        <template #no-data></template>
        <template #bottom="scope">
          <q-table-pagination
            :scope="scope"
            :resultTotal="resultTotal"
            position="bottom"
            :perPageOptions="perPageOptions"
            @update:changeRecordPerPage="changePagination"
          />
        </template>
        <template v-slot:body="props">
          <q-tr
            :data-test="`quota-role-list-table-${props.row.uuid}-row`"
            :props="props"
            style="cursor: pointer"
          >
            <q-td
              v-for="col in roleLimitsColumns"
              :key="col.name"
              :props="props"
              :style="col.style"
            >
              <template v-if="col.name == 'role_name'">
                <q-btn
                  dense
                  flat
                  size="xs"
                  :icon="
                    expandedRow != props.row.uuid
                      ? 'chevron_right'
                      : 'expand_more'
                  "
                  @click="triggerExpand(props)"
                />
                {{ props.row[col.name] }}
              </template>
              <template v-else> </template>
            </q-td>
          </q-tr>
          <q-tr
            v-if="!editTable && !isRoleLimitsLoading"
            v-for="(row, index) in filteredRoleLevelModuleRows"
            data-test="scheduled-pipeline-row-expand"
            v-show="expandedRow === props.row.uuid"
            :props="props"
          >
            <q-td v-for="col in props.cols" :key="col.name" :props="props">
              <template v-if="col.name == 'role_name'">
                <div style="padding-left: 20px">
                  {{ row["module_name"] }}
                </div>
              </template>
              <template v-else-if="col.name == '#'"> {{}} </template>
              <template v-else-if="row[col.name] == '-'"> - </template>
              <template v-else>
                {{ row[col.name] }}
              </template>
            </q-td>
          </q-tr>
          <q-tr
            v-if="editTable && !roleLevelLoading && !isRoleLimitsLoading"
            v-for="(row, index) in filteredRoleLevelModuleRows"
            data-test="scheduled-pipeline-row-expand"
            v-show="expandedRow === props.row.uuid"
            :props="props"
          >
            <q-td
              :style="{
                backgroundColor:
                  editTable && col.name !== 'role_name'
                    ? store.state.theme === 'dark'
                      ? '#212121'
                      : '#f1f1ee'
                    : 'transparent',
              }"
              :props="props"
              v-for="col in props.cols"
              :key="col.name"
              v-if="editTable"
              style="padding-left: 8px"
            >
              <template v-if="col.name == 'role_name'">
                <div style="padding-left: 20px">
                  {{ row["module_name"] }}
                </div>
              </template>
              <template v-else-if="col.name == '#'"> {{}} </template>
              <template v-else-if="row[col.name] == '-'"> - </template>
              <template v-else>
                <div
                  contenteditable="true"
                  debounce="500"
                  :class="{
                    'editable-cell': editTable && col.name !== 'module_name',
                    'edited-input': isEdited(row.module_name, col.name),
                  }"
                  @input="
                    (event: any) =>
                      handleInputChange(
                        props.row.role_name,
                        row.module_name,
                        row[col.name],
                        col.name,
                        event.target.innerText,
                      )
                  "
                  @keypress="restrictToNumbers"
                  @paste="preventNonNumericPaste"
                >
                  {{ row[col.name] }}
                </div>
              </template>
            </q-td>
          </q-tr>
          <q-tr v-if="isRoleLimitsLoading && props.row.uuid == expandedRow">
            <q-td v-for="col in props.cols" :key="col.name">
              <div v-if="col.name == 'create'" class="tw:h-[50vh] tw:w-full tw:flex tw:justify-center tw:items-center">
              <q-spinner-hourglass color="primary" size="lg" />
            </div>
            </q-td>
          </q-tr>
        </template>
      </q-table>
      </div>
      <div v-if="isRolesLoading && activeTab == 'role-limits' && activeType == 'table'" class="tw:h-[70vh] tw:flex tw:justify-center tw:items-center">
        <q-spinner-hourglass color="primary" size="lg" />
      </div>
      <div
        class="card-container"
        v-if="activeTab == 'role-limits' && activeType == 'json'"
        style="height: calc(100vh - 220px)"
      >
        <query-editor
          data-test="json-view-roles-editor"
          ref="queryEditorRef"
          editor-id="json-view-roles-editor"
          class="monaco-editor"
          :debounceTime="300"
          v-model:query="jsonStrToDisplay"
          language="json"
          style="height: 100%"
          :read-only="!editTable"
        />
      </div>
      <div
        v-if="
          (activeTab == 'api-limits' || activeTab == 'role-limits') &&
          loading &&
          !apiLimitsRows.length
        "
        class="flex justify-center items-center"
      >
        <q-spinner-hourglass color="primary" size="lg" />
      </div>
      <div
        v-else-if="
          activeTab == 'api-limits' && !loading && !selectedOrganization
        "
      >
        <NoOrganizationSelected />
      </div>
      <div
        v-else-if="
          activeTab == 'role-limits' && !loading && !selectedOrganization
        "
      >
        <NoOrganizationSelected />
      </div>
      <div
        v-else-if="
          activeTab == 'api-limits' && !loading && !apiLimitsRows.length && !isApiLimitsLoading
        "
      >
        <NoData />
      </div>
      <div
        v-else-if="
          activeTab == 'role-limits' && !loading && !rolesLimitRows.length && !isRolesLoading
        "
      >
        <NoData />
      </div>
      <div
        class="flex justify-end w-full tw:ml-auto floating-buttons q-pr-md tw:py-2"
        v-if="editTable && activeType == 'table'"
      >
        <q-btn
          label="Cancel"
          class="q-mr-md o2-secondary-button tw:h-[36px]"
          no-caps
          flat
          :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
          @click="cancelChanges"
        />
        <q-btn
          label="Save"
          class="o2-primary-button no-border tw:h-[36px]"
          :disable="Object.keys(changedValues).length === 0"
          no-caps
          flat
          :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
          @click="saveChanges"
        />
      </div>
      <div
        class="flex justify-end w-full tw:ml-auto floating-buttons q-pr-md q-mt-md"
        v-if="editTable && activeType == 'json'"
      >
        <q-btn
          label="Cancel"
          class="q-mr-md o2-secondary-button tw:h-[36px]"
          no-caps
          flat
          :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
          @click="cancelJsonChanges"
          :disable="isSavingJson"
        />
        <q-btn
          :label="isSavingJson ? 'Saving Changes...' : 'Save Changes'"
          class="o2-primary-button no-border tw:h-[36px]"
          no-caps
          flat
          :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
          @click="saveJsonChanges"
          :disable="isSavingJson"
        />
      </div>
    </div>

    <ConfirmDialog
      title="UnSaved Changes Detected"
      message="save changes before switching tabs"
      @update:ok="saveChangesAndTabSwitch"
      @update:cancel="discardChangesTabSwitch"
      v-model="showConfirmDialogTabSwitch"
    />
    <ConfirmDialog
      title="UnSaved Changes Detected"
      message="save changes before expanding another row"
      @update:ok="saveChangesAndRoleSwitch"
      @update:cancel="discardChangesRoleSwitch"
      v-model="showConfirmDialogRowSwitch"
    />
    <ConfirmDialog
      title="UnSaved Changes Detected"
      message="save changes before switching Type"
      @update:ok="saveChangesAndTypeSwitch"
      @update:cancel="discardChangesTypeSwitch"
      v-model="showConfirmDialogTypeSwitch"
    />
  </q-page>
</template>

<script lang="ts">
import { useI18n } from "vue-i18n";
import {
  computed,
  defineComponent,
  onMounted,
  reactive,
  ref,
  watch,
  defineAsyncComponent,
} from "vue";
import NoOrganizationSelected from "@/components/shared/grid/NoOrganizationSelected.vue";
import { useStore } from "vuex";
import organizationsService from "@/services/organizations";
import AppTabs from "@/components/common/AppTabs.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import { getRoles } from "@/services/iam";
import ratelimitService from "@/services/rate_limit";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import { getImageURL, getUUID } from "@/utils/zincutils";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

import useRateLimiter from "@/composables/useRateLimiter";
import {
  outlinedDelete,
  outlinedPause,
  outlinedPlayArrow,
  outlinedFileDownload,
  outlinedFileUpload,
  outlinedInsertDriveFile,
} from "@quasar/extras/material-icons-outlined";
import AppTable from "@/components/AppTable.vue";
import NoData from "@/components/shared/grid/NoData.vue";
export default defineComponent({
  name: "Quota",
  components: {
    NoOrganizationSelected,
    AppTabs,
    QTablePagination,
    ConfirmDialog,
    QueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    NoData,
  },
  setup() {
    const { t } = useI18n();
    const selectedOrganization = ref<any>(null);
    const store = useStore();
    const $q = useQuasar();
    const organizations = ref<any[]>([]);
    const isOrgLoading = ref<boolean>(false);
    const resultTotal = ref<number>(0);
    const perPageOptions = ref<number[]>([20, 50, 100, 250, 500]);
    const {
      getApiLimitsByOrganization,
      getRoleLimitsByOrganization,
      getModulesToDisplay,
      isRoleLimitsLoading,
      isApiLimitsLoading,
    } = useRateLimiter();
    const pagination: any = ref({
      rowsPerPage: 20,
    });
    const rolesLimitRows = ref<any[]>([]);
    const rolesColumns = ref<any[]>([]);
    const activeType = ref<any>("table");
    const activeTimeUnit = ref<string>("second");

    const tabs = ref<any[]>([
      {
        label: "API Limits",
        value: "api-limits",
      },
      {
        label: "Role Limits",
        value: "role-limits",
      },
    ]);

    const timeUnitTabs = ref<any[]>([
      {
        label: "Per Second",
        value: "second",
      },
      {
        label: "Per Minute",
        value: "minute",
      },
      {
        label: "Per Hour",
        value: "hour",
      },
    ]);

    const typeTabs = computed(() => [
      {
        label: "Table",
        value: "table",
      },
      {
        label: "JSON",
        value: "json",
        disabled: activeTab.value === "role-limits" && !expandedRow.value,
      },
    ]);

    const getTimeUnitLabel = () => {
      const unitMap: any = {
        second: "(Req/s)",
        minute: "(Req/m)",
        hour: "(Req/h)",
      };
      return unitMap[activeTimeUnit.value] || "(Req/s)";
    };

    const apiLimitsColumns = computed(() => {
      const unitLabel = getTimeUnitLabel();
      return [
        {
          name: "module_name",
          field: "module_name",
          label: t("quota.moduleName"),
          align: "left",
          sortable: true,
        },
        {
          name: "list",
          field: "list",
          label: `${t("quota.listLimit")} ${unitLabel}`,
          align: "center",
          sortable: true,
          style: "width: 200px !important; ",
        },
        {
          name: "get",
          field: "get",
          label: `${t("quota.getLimit")} ${unitLabel}`,
          align: "center",
          sortable: true,
          style: "width: 200px !important; ",
        },
        {
          name: "create",
          field: "create",
          label: `${t("quota.createLimit")} ${unitLabel}`,
          align: "center",
          sortable: true,
          style: "width: 200px !important; ",
        },
        {
          name: "update",
          field: "update",
          label: `${t("quota.updateLimit")} ${unitLabel}`,
          align: "center",
          sortable: true,
          style: "width: 200px !important; ",
        },
        {
          name: "delete",
          field: "delete",
          label: `${t("quota.deleteLimit")} ${unitLabel}`,
          align: "center",
          sortable: true,
          style: "width: 200px !important; ",
        },
      ];
    });
    const roleLimitsColumns = computed(() => {
      const unitLabel = getTimeUnitLabel();
      return [
        {
          name: "role_name",
          field: "role_name",
          label: t("quota.roleName"),
          align: "left",
          sortable: true,
        },
        {
          name: "list",
          field: "list",
          label: `${t("quota.listLimit")} ${unitLabel}`,
          align: "center",
          sortable: true,
          style: "width: 200px !important; ",
        },
        {
          name: "get",
          field: "get",
          label: `${t("quota.getLimit")} ${unitLabel}`,
          align: "center",
          sortable: true,
          style: "width: 200px !important; ",
        },
        {
          name: "create",
          field: "create",
          label: `${t("quota.createLimit")} ${unitLabel}`,
          align: "center",
          sortable: true,
          style: "width: 200px !important; ",
        },
        {
          name: "update",
          field: "update",
          label: `${t("quota.updateLimit")} ${unitLabel}`,
          align: "center",
          sortable: true,
          style: "width: 200px !important; ",
        },
        {
          name: "delete",
          field: "delete",
          label: `${t("quota.deleteLimit")} ${unitLabel}`,
          align: "center",
          sortable: true,
          style: "width: 200px !important; ",
        },
      ];
    });
    const activeTab = ref<string>("api-limits");
    const searchQuery = ref<string>("");
    const apiLimitsRows = ref<any[]>([]);
    const editTable = ref<boolean>(false);
    const changedValues = ref<any>({});
    const router = useRouter();
    const loading = ref<boolean>(false);
    const isBulkUpdate = ref<boolean>(false);
    const uploadedRules = ref<any>(null);
    const fileListToDisplay = ref<string>("");
    const uploadingRules = ref<boolean>(false);
    const uploadError = ref<string>("");
    const focusedInputId = ref<any>(null);
    const expandedRow = ref<any>("");
    const roleLevelModuleRows = ref<any[]>([]);
    const roleLevelLoading = ref<boolean>(false);

    const openedRole = ref<any>("");
    const selectedApiCategory = ref<any>(null);
    const rolesToBeDisplayed = ref<any[]>([]);
    const isApiCategoryLoading = ref<boolean>(false);
    const filteredRoleLevelModuleRows = ref<any[]>([]);
    const expandedRole = ref<string>("");
    const showConfirmDialogTabSwitch = ref(false);
    const showConfirmDialogRowSwitch = ref(false);
    const nextTab = ref<string | null>(null);
    const toBeExpandedRow = ref<any>(null);
    const jsonStrToDisplay = ref<string>("");
    const nextType = ref<string | null>(null);
    const showConfirmDialogTypeSwitch = ref(false);
    const isSavingJson = ref<boolean>(false);
    const filteredOrganizations = ref<any[]>([]);
    const filteredApiCategoryToDisplayOptions = ref<any[]>([]);
    const apiCategories = ref<any[]>([]);

    const selectedPerPage = ref<number>(20);
    const qTable = ref<any>(null);
    const isRolesLoading = ref<boolean>(false);

    onMounted(async () => {
      await getOrganizations();
      if (router.currentRoute.value.query.quota_org) {
        selectedOrganization.value = {
          label: router.currentRoute.value.query.quota_org,

          value: router.currentRoute.value.query.quota_org,
        };
      } else if (organizations.value.length > 0) {
        selectedOrganization.value = organizations.value[0];
      }
      if (selectedOrganization.value) {
        if (activeTab.value === "api-limits") {
          //here we are getting the api limits for the selected organization
          apiLimitsRows.value = await getApiLimitsByOrganization(
            selectedOrganization.value.value,
            activeTimeUnit.value,
          );
          resultTotal.value = apiLimitsRows.value.length;
        } else {
          //here we are getting the role limits for the selected organization
          await getRolesByOrganization();
        }
        //these are the modules that are displayed in the dropdown
        //to select the api category that user can use to filter the api limits
        if (!store.state.modulesToDisplay[selectedOrganization.value.value]) {
          apiCategories.value = await getModulesToDisplay(
            selectedOrganization.value.value,
          );
        } else {
          apiCategories.value =
            store.state.modulesToDisplay[selectedOrganization.value.value];
        }
      }
    });

    //watch here

    watch(
      () => uploadedRules.value,
      (newVal) => {
        if (!newVal || newVal.length == 0) {
          fileListToDisplay.value = "";
          return;
        }
        fileListToDisplay.value = "";
        if (newVal.length > 1) {
          newVal.forEach((file: any) => {
            fileListToDisplay.value += file.name + ",";
          });
        } else {
          fileListToDisplay.value = newVal[0].name;
        }
      },
    );
    watch(
      () => selectedOrganization.value,
      async (newVal) => {
        if (newVal && !store.state.modulesToDisplay[newVal.value]) {
          apiCategories.value = await getModulesToDisplay(newVal.value);
        } else {
          apiCategories.value = store.state.modulesToDisplay[newVal.value];
        }
      },
    );

    //computed here

    const organizationToDisplay = computed(() => {
      if (activeTab.value === "api-limits") {
        const newArray = [...filteredOrganizations.value];
        newArray.unshift({
          label: "global rules",
          value: "global_rules",
        });
        return newArray;
      } else {
        return filteredOrganizations.value;
      }
    });
    const updateOrganization = async () => {
      router.push({
        ...router.currentRoute.value,
        query: {
          ...router.currentRoute.value.query,
          quota_org: selectedOrganization.value.value.toLowerCase(),
        },
      });

      if (activeTab.value === "api-limits") {
        if (
          !store.state.allApiLimitsByOrgId[selectedOrganization.value.value]
        ) {
          apiLimitsRows.value = await getApiLimitsByOrganization(
            selectedOrganization.value.value,
            activeTimeUnit.value,
          );
          resultTotal.value = apiLimitsRows.value.length;
        } else {
          apiLimitsRows.value =
            store.state.allApiLimitsByOrgId[selectedOrganization.value.value];
          resultTotal.value = apiLimitsRows.value.length;
        }
      } else if (activeTab.value === "role-limits") {
        await getRolesByOrganization();
      }
    };
    const getOrganizations = async () => {
      //this is used to get the organization from the api
      if (store.state.organizations.length === 0) {
        try {
          isOrgLoading.value = true;
          const response = await organizationsService.os_list(
            0,
            100000,
            "id",
            false,
            "",
            "default",
          );
          organizations.value = response.data.data.map((org: any) => ({
            label: org.name,
            value: org.identifier,
          }));
          organizations.value.sort((a: any, b: any) =>
            a.label.localeCompare(b.label),
          );
          isOrgLoading.value = false;
        } catch (error) {
          isOrgLoading.value = false;
          console.log(error);
        } finally {
          isOrgLoading.value = false;
        }
      } else {
        organizations.value = store.state.organizations.map((org: any) => ({
          label: org.name,
          value: org.identifier,
        }));
      }
    };
    const updateActiveTab = (tab: string) => {
      let isChanged = Object.keys(changedValues.value).length > 0;

      if (isChanged) {
        nextTab.value = tab; // Store the tab user wants to switch to
        showConfirmDialogTabSwitch.value = true; // Show confirmation dialog
      } else {
        switchTab(tab);
      }
    };
    //this is used to switch the tab
    const switchTab = async (tab: string) => {
      //here when we switch the tab we need to reset the activeType and activeTab
      //active type to table --> reason: sometimes user might have shift from api-limits to role-limits and if activeType is json then none of the row is expanded right
      //which will lead to the issue that user will not be able to see the table data
      activeType.value = "table";
      activeTab.value = tab;
      //
      if (tab === "role-limits") {
        //here we are checking if the organization is global_rules_meta then we need to reset the selectedOrganization to the first valid organization
        //as we dont support global_rules_meta in role limits
        if (router.currentRoute.value.query.quota_org == "global_rules") {
          selectedOrganization.value = organizations.value[0];
        }
        //here we are getting the roles from the api
        //as we are not storing the roles in the store
        //so we need to get the roles from the api
        await getRolesByOrganization();
      }
      if (tab === "api-limits") {
        if (
          !store.state.allApiLimitsByOrgId[selectedOrganization.value.value]
        ) {
          apiLimitsRows.value = await getApiLimitsByOrganization(
            selectedOrganization.value.value,
            activeTimeUnit.value,
          );
        } else {
          apiLimitsRows.value =
            store.state.allApiLimitsByOrgId[selectedOrganization.value.value];
        }
        resultTotal.value = apiLimitsRows.value.length;
      }
    };
    //this is used to save the changes and switch the tab
    //when user confirms the changes and click save in the confirm dialog
    const saveChangesAndTabSwitch = async () => {
      await saveChanges();
      changedValues.value = {};
      editTable.value = false;
      showConfirmDialogTabSwitch.value = false;
      jsonStrToDisplay.value = "";
      if (nextTab.value) {
        switchTab(nextTab.value);
        nextTab.value = null;
      }
    };

    const discardChangesTabSwitch = () => {
      //when user discard the changes and swith the tab we just reset the changedValues and editTable
      //and also we need to reset the activeType
      //we just assign the stored tab value to the activeTab
      changedValues.value = {};
      editTable.value = false;
      if (nextTab.value) {
        switchTab(nextTab.value);
        nextTab.value = null;
      }
      showConfirmDialogTabSwitch.value = false;
    };
    const editTableWithInput = () => {
      editTable.value = true;
    };
    const getRolesByOrganization = async () => {
      //here we are getting the roles from the api
      //as we are not storing the roles in the store
      //so we need to get the roles from the api
      try {
        isRolesLoading.value = true;
        const response = await getRoles(selectedOrganization.value?.value);
        rolesLimitRows.value = response.data.map((role: any) => ({
          role_name: role,
          uuid: getUUID(),
          list: 10,
          get: 10,
          create: 10,
          update: 10,
          delete: 10,
        }));
        resultTotal.value = rolesLimitRows.value.length;
        isRolesLoading.value = false;
      } catch (error) {
        console.log(error);
        isRolesLoading.value = false;
      }
    };
    const restrictToNumbers = (event: any) => {
      const char = String.fromCharCode(event.keyCode);

      // Allow numbers, backspace, delete, tab, enter, and decimal point
      if (!/[0-9.]/.test(char) && ![8, 46, 9, 13].includes(event.keyCode)) {
        event.preventDefault();
      }
    };
    //this is used for handling the input changes for both api limits and row limits
    const handleInputChange = (
      roleName: any = "",
      moduleName: string,
      row: any,
      operation: string,
      value: any,
    ) => {
      let cleanedValue = value.replace(/[^0-9.]/g, "");

      // Prevent multiple dots
      const parts = cleanedValue.split(".");
      if (parts.length > 2) {
        cleanedValue = parts[0] + "." + parts.slice(1).join("");
      }

      // Ensure empty string is stored instead of NaN
      if (cleanedValue === ".") {
        cleanedValue = "";
      }

      // Update value in changedValues
      if (!changedValues.value[moduleName]) {
        changedValues.value[moduleName] = reactive({});
      }
      changedValues.value[moduleName][operation] = cleanedValue;

      let valueToUpdate;

      if (isNaN(parseInt(value))) {
        valueToUpdate = "";
      } else {
        valueToUpdate = parseInt(value);
      }
      changedValues.value[moduleName][operation] = valueToUpdate;
    };

    const saveChanges = async () => {
      try {
        if (!validateChanges(changedValues.value)) {
          return;
        }
        let payload: any = {};
        payload = { ...changedValues.value };
        let user_role = expandedRole.value;
        let response = null;
        if (activeTab.value === "api-limits") {
          response = await ratelimitService.update_batch(
            selectedOrganization.value.value,
            payload,
            "module",
            undefined,
            activeTimeUnit.value,
          );
        } else {
          response = await ratelimitService.update_batch(
            selectedOrganization.value.value,
            payload,
            "role",
            user_role,
            activeTimeUnit.value,
          );
        }
        if (selectedOrganization.value.value == "global_rules") {
          resetStore();
        }
        // Here you would call your API to save the changes
        if (response.status === 200) {
          uploadError.value = "";
          uploadedRules.value = [];
          isBulkUpdate.value = false;
          $q.notify({
            type: "positive",
            message: response.data.message,
            timeout: 3000,
          });
        }

        // After successful save, refresh the data
        editTable.value = false;
        if (activeTab.value === "api-limits") {
          apiLimitsRows.value = await getApiLimitsByOrganization(
            selectedOrganization.value.value,
            activeTimeUnit.value,
          );
          resultTotal.value = apiLimitsRows.value.length;
        } else if (activeTab.value === "role-limits") {
          roleLevelModuleRows.value = await getRoleLimitsByOrganization(
            selectedOrganization.value.value,
            openedRole.value,
            activeTimeUnit.value,
          );
          filterModulesBasedOnCategory();
        }
        changedValues.value = {};
      } catch (error: any) {
        $q.notify({
          type: "negative",
          message:
            error.response.data.message ||
            "Error while updating rate limits rule",
          timeout: 3000,
        });
        console.error("Error saving changes:", error);
      }
    };

    const cancelChanges = () => {
      changedValues.value = {};
      editTable.value = false;
    };

    const cancelJsonChanges = () => {
      changedValues.value = {};
      editTable.value = false;
    };

    const saveJsonChanges = async () => {
      try {
        isSavingJson.value = true;
        let user_role = expandedRole.value;
        const payload = JSON.parse(jsonStrToDisplay.value);
        let response = null;
        if (activeTab.value === "api-limits") {
          response = await ratelimitService.update_batch(
            selectedOrganization.value.value,
            payload,
            "module",
            undefined,
            activeTimeUnit.value,
          );
        } else {
          response = await ratelimitService.update_batch(
            selectedOrganization.value.value,
            payload,
            "role",
            user_role,
            activeTimeUnit.value,
          );
        }
        if (selectedOrganization.value.value == "global_rules") {
          resetStore();
        }
        // Here you would call your API to save the changes
        if (response.status === 200) {
          $q.notify({
            type: "positive",
            message: response.data.message,
            timeout: 3000,
          });
        }

        // After successful save, refresh the data
        editTable.value = false;
        if (activeTab.value === "api-limits") {
          apiLimitsRows.value = await getApiLimitsByOrganization(
            selectedOrganization.value.value,
            activeTimeUnit.value,
          );
          resultTotal.value = apiLimitsRows.value.length;
        } else {
          roleLevelModuleRows.value = await getRoleLimitsByOrganization(
            selectedOrganization.value.value,
            openedRole.value,
            activeTimeUnit.value,
          );
          filterModulesBasedOnCategory();
        }
        isSavingJson.value = false;
      } catch (error: any) {
        isSavingJson.value = false;
        $q.notify({
          type: "negative",
          message:
            error.response.data.message ||
            "Error while updating rate limits rule",
          timeout: 3000,
        });
        console.error("Error saving changes:", error);
      }
    };

    const isEdited = (moduleName: string, operation: string) => {
      return (
        changedValues.value[moduleName] &&
        changedValues.value[moduleName][operation] !== undefined
      );
    };

    const generateColumns = () => {
      if (
        selectedOrganization.value?.hasOwnProperty("value") &&
        selectedOrganization.value.value != ""
      ) {
        return apiLimitsColumns.value;
      } else {
        return [];
      }
    };

    const downloadTemplate = async () => {
      try {
        const response = await ratelimitService.download_template(
          selectedOrganization.value.value,
        );
        const blob = new Blob([response.data], { type: "application/json" });
        const jsonData = JSON.stringify(response.data, null, 2);
        const url = window.URL.createObjectURL(
          new Blob([jsonData], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `rate_limit_template_${selectedOrganization.value.label}.json`;
        document.body.appendChild(a);
        a.click();
      } catch (error) {
        console.log(error);
      }
    };

    const uploadTemplate = async () => {
      const combinedJson = await convertUploadRulesToJson(uploadedRules.value);
      try {
        const dismiss = $q.notify({
          spinner: true,
          message: "Please wait while uploading rules...",
          timeout: 1000,
        });
        uploadingRules.value = true;
        const response = await ratelimitService.upload_template(
          selectedOrganization.value.value,
          combinedJson,
        );
        if (response.status === 200) {
          $q.notify({
            type: "positive",
            message: response.data.message,
            timeout: 3000,
          });
        }
        uploadingRules.value = false;
        isBulkUpdate.value = false;
        uploadedRules.value = null;
        await getApiLimitsByOrganization(selectedOrganization.value.value);
        dismiss();
      } catch (error) {
        uploadingRules.value = false;
        uploadError.value = "Error while uploading rules";
      } finally {
        uploadingRules.value = false;
      }
    };

    const convertUploadRulesToJson = async (files: any) => {
      let combinedJson: any[] = [];

      for (const file of files) {
        try {
          const result: any = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e: any) => {
              try {
                const parsedJson = JSON.parse(e.target.result);
                // Convert to array if it's a single object
                const jsonArray = Array.isArray(parsedJson)
                  ? parsedJson
                  : [parsedJson];
                resolve(jsonArray);
              } catch (error) {
                $q.notify({
                  message: `Error parsing JSON from file ${file.name}`,
                  color: "negative",
                  position: "bottom",
                  timeout: 2000,
                });
                resolve([]);
              }
            };
            reader.readAsText(file);
          });

          combinedJson = [...combinedJson, ...result];
        } catch (error) {
          console.error("Error reading file:", error);
        }
      }
      return combinedJson;
    };
    const closeBulkUpdate = () => {
      isBulkUpdate.value = false;
      uploadedRules.value = null;
      uploadError.value = "";
    };
    const onFocus = (row: any) => {
      focusedInputId.value = generateUniqueId(row);
    };

    const generateUniqueId = (row: any) => {
      return row.api_group_name + "_" + row.api_group_operation;
    };
    const filteredData = (rows: any, terms: any) => {
      var filtered = [];
      terms = terms.toLowerCase();
      if (activeTab.value === "api-limits") {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].module_name.toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
      } else {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].role_name.toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
      }

      return filtered;
    };
    const triggerExpand = async (props: any) => {
      if (Object.keys(changedValues.value).length > 0) {
        showConfirmDialogRowSwitch.value = true;
        toBeExpandedRow.value = props.row;
        return;
      }
      expandedRole.value = props.row.role_name;
      if (expandedRow.value === props.row.uuid) {
        expandedRow.value = null;
        openedRole.value = null;
      } else {
        openedRole.value = props.row.role_name;
        //expand the row at first only because we need to show the loading state for the user 
        expandedRow.value = props.row.uuid;
        let roleLimits: any;
        if (
          !store.state.allRoleLimitsByOrgIdByRole[
            selectedOrganization.value.value
          ]?.[props.row.role_name]
        ) {
          roleLevelModuleRows.value = await getRoleLimitsByOrganization(
            selectedOrganization.value.value,
            props.row.role_name,
            activeTimeUnit.value,
          );
        } else {
          roleLevelModuleRows.value =
            store.state.allRoleLimitsByOrgIdByRole[
              selectedOrganization.value.value
            ][props.row.role_name];
        }
        filterModulesBasedOnCategory();
        // Otherwise, expand the clicked row and collapse any other row
      }
    };

    const preventNonNumericPaste = (event: any) => {
      const clipboardData = event.clipboardData.getData("text");

      // Allow only positive integers (no negatives, no decimals)
      if (!/^\d+$/.test(clipboardData)) {
        event.preventDefault();
      }
    };

    const validateChanges = (changedValues: any) => {
      let isEmpty = false;
      Object.keys(changedValues).forEach((moduleName: any) => {
        Object.keys(changedValues[moduleName]).forEach((operation: any) => {
          if (changedValues[moduleName][operation] === "") {
            $q.notify({
              type: "negative",
              message: "some values are empty please check",
              timeout: 3000,
            });
            isEmpty = true;
          }
        });
      });
      if (isEmpty) {
        return false;
      }
      return true;
    };
    const saveChangesAndRoleSwitch = async () => {
      await saveChanges();
      showConfirmDialogRowSwitch.value = false;
      if (toBeExpandedRow.value) {
        const index = rolesLimitRows.value.findIndex(
          (row: any) => row.role_name === toBeExpandedRow.value.role_name,
        );
        expandedRow.value = rolesLimitRows.value[index].uuid;
        toBeExpandedRow.value = null;
      }
    };
    const discardChangesRoleSwitch = () => {
      showConfirmDialogRowSwitch.value = false;
      expandedRole.value = toBeExpandedRow.value.role_name;
      expandedRow.value = toBeExpandedRow.value.uuid;
      toBeExpandedRow.value = null;
    };
    const transformData = (data: any) => {
      return data.reduce((acc: any, item: any) => {
        // Convert module_name to snake_case
        const key = item.module_name;

        // Remove keys with "-" values
        const filteredItem = Object.fromEntries(
          Object.entries(item).filter(
            ([k, v]) => k !== "module_name" && v !== "-",
          ),
        );

        // Assign the cleaned object to the transformed key
        acc[key] = filteredItem;
        return acc;
      }, {});
    };
    const updateActiveType = (type: string) => {
      //here we are updating the active type to json mode or table mode
      //if the active type is json then we need to check if the changes are there in the changedValues
      //if the changes are there then we need to show the confirm dialog
      //if the changes are not there then we need to update the active type to json mode

      if (type == "json") {
        let isChanged = Object.keys(changedValues.value).length > 0;
        if (isChanged && editTable.value) {
          nextType.value = type.toLowerCase();
          showConfirmDialogTypeSwitch.value = true;
        } else {
          activeType.value = type.toLowerCase();
          editTable.value = false;
          populateJsonStr();
        }
      }
      //if the active type is table then we need to check if the changes are there in the jsonStrToDisplay
      //if the changes are there then we need to show the confirm dialog
      //if the changes are not there then we need to update the active type to table mode
      else {
        //here we are checking if any changes are made to the json string so that we can show the confirm dialog
        let isChanged = jsonDiff(
          jsonStrToDisplay.value,
          transformData(apiLimitsRows.value),
        );
        if (isChanged && editTable.value) {
          //here we store the next type to be used when the user confirms the changes
          nextType.value = type.toLowerCase();
          showConfirmDialogTypeSwitch.value = true;
        }
        //if no changes are made then we are updating the active type to table mode
        else {
          activeType.value = type.toLowerCase();
          editTable.value = false;
        }
      }
    };

    const populateJsonStr = () => {
      if (activeTab.value == "api-limits") {
        jsonStrToDisplay.value = JSON.stringify(
          transformData(apiLimitsRows.value),
          null,
          2,
        );
      } else {
        jsonStrToDisplay.value = JSON.stringify(
          transformData(filteredRoleLevelModuleRows.value),
          null,
          2,
        );
      }
    };
    const saveChangesAndTypeSwitch = async () => {
      await saveChanges();
      editTable.value = false;
      populateJsonStr();
      showConfirmDialogTypeSwitch.value = false;
      activeType.value = nextType.value;
      nextType.value = null;
      changedValues.value = {};
    };
    const discardChangesTypeSwitch = () => {
      showConfirmDialogTypeSwitch.value = false;
      activeType.value = nextType.value;
      nextType.value = null;
      editTable.value = false;
      changedValues.value = {};
      populateJsonStr();
    };
    const jsonDiff = (oldJson: any, newJson: any): boolean => {
      return JSON.stringify(oldJson) !== JSON.stringify(newJson);
    };
    const filterOrganizations = (val: any, update: any) => {
      if (val.length > 0) {
        update();
        filteredOrganizations.value = organizations.value.filter((org: any) =>
          org.label.toLowerCase().includes(val.toLowerCase()),
        );
      } else {
        update();
        filteredOrganizations.value = organizations.value;
      }
    };
    //this is used to search the api categories that is there role-limit
    //we do have multiple api categories so we need to filter them based on the search query
    const filterApiCategoriesToDisplayOptions = (val: any, update: any) => {
      if (val.length > 0) {
        update();
        filteredApiCategoryToDisplayOptions.value = apiCategories.value.filter(
          (role: any) => role.label.toLowerCase().includes(val.toLowerCase()),
        );
      } else {
        update();
        filteredApiCategoryToDisplayOptions.value = apiCategories.value;
      }
    };
    const changePagination = (val: { label: string; value: any }) => {
      //used to change the pagination of the table
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value?.setPagination(pagination.value);
    };
    //here we are filtering the modules based on the selected api category
    const filterModulesBasedOnCategory = () => {
      //here we filter based upon selectedapicategory so we only user can able to see one module at a time
      //if they apply filter
      if (selectedApiCategory.value?.value) {
        filteredRoleLevelModuleRows.value = roleLevelModuleRows.value.filter(
          (row: any) =>
            row.module_name.toLowerCase() ===
            selectedApiCategory.value?.value.toLowerCase(),
        );
      } else {
        filteredRoleLevelModuleRows.value = roleLevelModuleRows.value;
      }
    };
    const resetStore = () => {
      store.dispatch("setApiLimitsByOrgId", {});
      store.dispatch("setRoleLimitsByOrgIdByRole", {});
    };

    const updateTimeUnit = async (newTimeUnit: string) => {
      // Check if there are unsaved changes
      let isChanged = Object.keys(changedValues.value).length > 0;

      if (isChanged) {
        $q.notify({
          type: "warning",
          message: "Please save or cancel your changes before switching time units",
          timeout: 3000,
        });
        // Revert back to previous time unit
        activeTimeUnit.value = activeTimeUnit.value;
        return;
      }

      activeTimeUnit.value = newTimeUnit;

      // Refresh data for new time unit
      if (activeTab.value === "api-limits") {
        const storeKey = `${selectedOrganization.value.value}_${newTimeUnit}`;
        if (store.state.allApiLimitsByOrgId[storeKey]) {
          // Use cached data
          apiLimitsRows.value = store.state.allApiLimitsByOrgId[storeKey];
        } else {
          // Fetch from API
          apiLimitsRows.value = await getApiLimitsByOrganization(
            selectedOrganization.value.value,
            newTimeUnit,
          );
        }
        resultTotal.value = apiLimitsRows.value.length;
      } else if (activeTab.value === "role-limits" && openedRole.value) {
        const storeKey = `${openedRole.value}_${newTimeUnit}`;
        if (store.state.allRoleLimitsByOrgIdByRole[selectedOrganization.value.value]?.[storeKey]) {
          // Use cached data
          roleLevelModuleRows.value = store.state.allRoleLimitsByOrgIdByRole[selectedOrganization.value.value][storeKey];
        } else {
          // Fetch from API
          roleLevelModuleRows.value = await getRoleLimitsByOrganization(
            selectedOrganization.value.value,
            openedRole.value,
            newTimeUnit,
          );
        }
        filterModulesBasedOnCategory();
      }

      // Update JSON view if in JSON mode
      if (activeType.value === "json") {
        populateJsonStr();
      }
    };

    return {
      t,
      selectedOrganization,
      organizations,
      updateOrganization,
      isOrgLoading,
      activeTab,
      updateActiveTab,
      tabs,
      typeTabs,
      editTable,
      searchQuery,
      resultTotal,
      perPageOptions,
      rolesLimitRows,
      rolesColumns,
      apiLimitsRows,
      apiLimitsColumns,
      pagination,
      editTableWithInput,
      store,
      handleInputChange,
      changedValues,
      cancelChanges,
      saveChanges,
      isEdited,
      generateColumns,
      loading,
      isBulkUpdate,
      outlinedFileDownload,
      outlinedFileUpload,
      uploadedRules,
      outlinedInsertDriveFile,
      getImageURL,
      fileListToDisplay,
      downloadTemplate,
      uploadTemplate,
      uploadError,
      uploadingRules,
      closeBulkUpdate,
      focusedInputId,
      onFocus,
      generateUniqueId,
      filteredData,
      roleLimitsColumns,
      triggerExpand,
      expandedRow,
      roleLevelModuleRows,
      roleLevelLoading,
      getRoleLimitsByOrganization,
      selectedApiCategory,
      rolesToBeDisplayed,
      isApiCategoryLoading,
      filteredRoleLevelModuleRows,
      restrictToNumbers,
      preventNonNumericPaste,
      expandedRole,
      showConfirmDialogTabSwitch,
      showConfirmDialogRowSwitch,
      nextTab,
      saveChangesAndTabSwitch,
      discardChangesTabSwitch,
      saveChangesAndRoleSwitch,
      discardChangesRoleSwitch,
      toBeExpandedRow,
      activeType,
      updateActiveType,
      jsonStrToDisplay,
      nextType,
      showConfirmDialogTypeSwitch,
      saveChangesAndTypeSwitch,
      discardChangesTypeSwitch,
      saveJsonChanges,
      cancelJsonChanges,
      isSavingJson,
      filteredOrganizations,
      filterOrganizations,
      filteredApiCategoryToDisplayOptions,
      filterApiCategoriesToDisplayOptions,
      changePagination,
      selectedPerPage,
      qTable,
      organizationToDisplay,
      filterModulesBasedOnCategory,
      // Expose internals for unit tests
      apiCategories,
      validateChanges,
      transformData,
      convertUploadRulesToJson,
      jsonDiff,
      isRoleLimitsLoading,
      isApiLimitsLoading,
      isRolesLoading,
      activeTimeUnit,
      timeUnitTabs,
      updateTimeUnit,
      getTimeUnitLabel,
    };
  },
});
</script>

<style lang="scss">
.quota-page {
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .title-height {
    height: 40px;
    min-height: 40px;
  }
  .input-width {
    width: 300px;
  }
}
.floating-buttons {
  position: sticky;
  bottom: 0;
  top: 0;
  z-index: 100; /* Ensure it stays on top of table content */
  width: 100%;
}
.dark-theme-page {
  .floating-buttons {
    background-color: $dark;
  }
}
.light-theme-page {
  .floating-buttons {
    background-color: $white;
  }
}
.light-theme-page {
  .editable-cell {
    padding: 0px 10px;
    background-color: #f1f1ee;
  }
  .edited-cell {
    padding-left: 8px !important; // light blue color
  }
  .edited-input {
    background-color: #bfc3f4;
    color: black; // blue text color for edited values
    font-weight: 500;
  }
  .edited-input-role-level {
    color: #2196f3; // blue text color for edited values
    font-weight: 500;
  }
}

.dark-theme-page {
  .editable-cell {
    padding: 0px 10px;
  }
  .edited-cell {
    padding-left: 8px !important;
  }
  .edited-input {
    background-color: #f6f6f6;
    color: black;
    font-weight: 500;
    padding: 0px !important;
  }
  .edited-input-role-level {
    color: #64b5f6; // lighter blue text color for dark theme
    font-weight: 500;
    width: 100% !important;
  }
}
.file-upload-input {
  height: 100% !important;
}

.file-upload-input > .q-field__inner {
  height: 100% !important;
}

.file-upload-input > .q-field__inner > .q-field__control {
  height: 100% !important;
}

.file-upload-input
  > .q-field__inner
  > .q-field__control
  .q-field__control-container {
  height: 100% !important;
}
.file-upload-input
  > .q-field__inner
  > .q-field__control
  .q-field__control-container
  .q-field__label {
  height: 100% !important;
  width: 100% !important;
  display: flex;
  align-items: start;
  justify-content: start;
}
.focused-input {
  border: 1px solid #007bff; /* Customize the border color */
  box-shadow: 0 0 5px rgba(0, 123, 255, 0.5); /* Optional: Add shadow for better focus effect */
  width: 100% !important;
}

.expanded-content {
  padding: 0 3rem;
  max-height: 100vh; /* Set a fixed height for the container */
  overflow: hidden; /* Hide overflow by default */
}

.scrollable-content {
  width: 100%; /* Use the full width of the parent */
  overflow-y: auto; /* Enable vertical scrolling for long content */
  padding: 10px; /* Optional: padding for aesthetics */
  border: 1px solid #ddd; /* Optional: border for visibility */
  height: 100%;
  max-height: 200px;
  /* Use the full height of the parent */
  text-wrap: normal;
  background-color: #e8e8e8;
  color: black;
}
.expanded-sql {
  border-left: #7a54a2 3px solid;
}

.app-table-container {
  .q-table{
    thead{
          tr {
      background: var(--o2-table-header-bg) !important;
    }
    }
  }
  .thead-sticky,
  .tfoot-sticky {
    position: sticky;
    top: 0;
    opacity: 1;
    z-index: 1;
    background: #f5f5f5;
  }

  .q-table--dark .thead-sticky,
  .q-table--dark .tfoot-sticky {
    background: #565656 !important;
  }

  .q-table__bottom {
    .q-table__control {
      padding-top: 0;
      padding-bottom: 0;
    }
  }
}

.editable-input {
  height: 10px !important;
}

.category-select {
  .q-placeholder {
    font-size: 14px !important;
  }
}
.org-select {
  .q-placeholder {
    font-size: 14px !important;
  }
}
</style>
