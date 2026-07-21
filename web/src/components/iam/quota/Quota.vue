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
<!-- TODO: remove the store.state.theme based styling on this page; theming is centralised in app.scss -->
<template>
  <OPageLayout
    class="quota-page text-left"
    :class="isDark ? 'dark-theme-page' : 'light-theme-page'"
    :title="t('quota.header')"
    title-data-test="user-title-text"
    :subtitle="t('iam.quotaPage.subtitle')"
    icon="speed"
    bleed
  >
    <div :style="{ marginTop: 0 }" class="app-table-container flex flex-col flex-1 min-h-0">
      <div class="bg-card-glass-bg mb-2.5 mt-2.5">
        <div class="px-3 py-2">
          <div class="flex items-center justify-between w-full mb-2">
            <div class="flex items-center">
              <OSelect
                :loading="isOrgLoading"
                :model-value="selectedOrganization?.value"
                :options="organizationToDisplay"
                searchable
                :placeholder="t('iam.quotaPage.selectOrganization')"
                class="py-2 no-case mr-3 w-75 input-width org-select"
                labelKey="label"
                valueKey="value"
                @update:model-value="handleOrgSelect"
              />
              <div class="app-tabs-container h-9 w-fit">
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
              <OButton
                v-if="!editTable"
                data-test="edit-table-btn"
                variant="outline"
                size="sm"
                :disabled="activeTab == 'role-limits' && !expandedRow"
                @click="editTableWithInput"
              >
                {{ t('iam.quotaPage.editQuota') }}
                <template #icon-right>
                  <OIcon name="edit" size="sm" class="opacity-70" style="font-weight: 200" />
                </template>
              </OButton>
            </div>
          </div>
          <div class="flex items-center justify-between w-full mb-2">
            <div
              v-if="selectedOrganization && activeType == 'table'"
              class="flex items-center"
            >
              <OSearchInput
                data-test="pipeline-list-search-input"
                v-model="searchQuery"
                style="width: 200px"
                :placeholder="
                  {
                    'api-limits': t('quota.api-search'),
                    'role-limits': t('quota.role-search'),
                  }[activeTab]
                "
              />
              <OSelect
                v-if="activeTab == 'role-limits'"
                :loading="isApiCategoryLoading"
                :model-value="selectedApiCategory?.value"
                :options="apiCategories"
                searchable
                clearable
                :placeholder="t('iam.quotaPage.selectApiCategory')"
                class="no-case mr-3 w-75 input-width ml-3 category-select p-0"
                labelKey="label"
                valueKey="value"
                @update:model-value="handleApiCategorySelect"
              />
            </div>
            <div
              v-if="selectedOrganization"
              class="flex items-center float-right ml-auto"
            >
              <div class="app-tabs-container h-9 w-fit mr-3">
                <app-tabs
                  data-test="time-unit-tabs"
                  class="tabs-selection-container"
                  :tabs="timeUnitTabs"
                  v-model:active-tab="activeTimeUnit"
                  @update:active-tab="updateTimeUnit"
                />
              </div>
              <div class="app-tabs-container h-9 w-fit">
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
      <div v-if="activeTab == 'api-limits' && activeType == 'table'" class="bg-card-glass-bg flex-1 min-h-0 overflow-hidden">
      <OTable
        :data="apiLimitsRows"
        :columns="generateColumns()"
        row-key="module_name"
        :loading="isApiLimitsLoading"
        :global-filter="searchQuery"
        pagination="client"
        :page-size="20"
        sorting="client"
        filter-mode="client"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="iam-quota-api-limits"
        :show-global-filter="false"
      >
        <template #empty>
          <OEmptyState
            size="hero"
            preset="no-api-limits"
            :filtered="!!searchQuery"
            :hide-action="!searchQuery"
            @action="(id) => id === 'clear-filters' && (searchQuery = '')"
          />
        </template>
        <template #bottom />
        <template v-for="col in apiLimitCrudColumnIds" :key="col" #[`cell-${col}`]="{ row, value }">
          <div v-if="editTable" class="bg-surface-subtle">
            <div
              v-if="value != '-'"
              contenteditable="true"
              debounce="500"
              :class="{
                'editable-cell': editTable,
                'px-2.5': editTable,
                'py-0': editTable && !isDark,
                'edited-input': isEdited(row.module_name, col),
                'bg-table-row-selected-bg text-table-highlight-text font-medium': isEdited(row.module_name, col),
                'p-0!': isEdited(row.module_name, col) && isDark,
              }"
              @input="(event: any) => handleInputChange('', row.module_name, value, col, event.target.innerText)"
              @keypress="restrictToNumbers"
              @paste="preventNonNumericPaste"
            >
              {{ changedValues[row.module_name]?.[col] ?? value }}
            </div>
            <div v-else>-</div>
          </div>
          <template v-else>
            {{ value }}
          </template>
        </template>
      </OTable>
      </div>

      <div
        class="bg-card-glass-bg pb-2.5 flex-1 min-h-0"
        v-if="activeTab == 'api-limits' && activeType == 'json'"
      >
        <query-editor
          data-test="json-view-roles-editor"
          ref="queryEditorRef"
          editor-id="json-view-roles-editor"
          :debounceTime="300"
          v-model:query="jsonStrToDisplay"
          language="json"
          class="h-full"
          :read-only="!editTable"
        />
      </div>
      <!-- this table for role limits -->
       <div v-if="activeTab == 'role-limits' && activeType == 'table'"  class="bg-card-glass-bg flex-1 min-h-0 overflow-hidden">
        <OTable
          :data="rolesLimitRows"
          :columns="roleLimitsColumns"
          row-key="uuid"
          :loading="isRolesLoading"
          :global-filter="searchQuery"
          pagination="client"
          :page-size="20"
          sorting="client"
          filter-mode="client"
          expansion="single"
          :default-columns="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="iam-quota-role-limits"
          :show-global-filter="false"
          @update:expanded-ids="handleExpandedChange"
        >
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-role-limits"
              :filtered="!!searchQuery"
              :hide-action="!searchQuery"
              @action="(id) => id === 'clear-filters' && (searchQuery = '')"
            />
          </template>
          <template #bottom />
          <template #cell-role_name="{ row }">
            {{ row.role_name }}
          </template>
          <template #expansion="{ row }">
            <template v-for="(moduleRow, index) in filteredRoleLevelModuleRows" :key="index">
              <div v-if="!editTable" class="flex items-center px-6 py-1 text-sm border-b border-table-row-divider">
                <span class="w-50">{{ moduleRow.module_name }}</span>
                <span v-for="col in roleLimitCrudColumnIds" :key="col" class="flex-1 text-center">
                  <template v-if="moduleRow[col] == '-'">-</template>
                  <template v-else>{{ moduleRow[col] }}</template>
                </span>
              </div>
              <div v-else class="flex items-center px-6 py-1 text-sm border-b border-table-row-divider">
                <span class="w-50">{{ moduleRow.module_name }}</span>
                <span v-for="col in roleLimitCrudColumnIds" :key="col" class="flex-1 text-center">
                  <template v-if="moduleRow[col] == '-'">-</template>
                  <div v-else
                    contenteditable="true"
                    debounce="500"
                    :class="{
                      'editable-cell': true,
                      'px-2.5': true,
                      'py-0': !isDark,
                      'bg-surface-subtle': !isEdited(moduleRow.module_name, col),
                      'edited-input': isEdited(moduleRow.module_name, col),
                      'bg-table-row-selected-bg text-table-highlight-text font-medium': isEdited(moduleRow.module_name, col),
                      'p-0!': isEdited(moduleRow.module_name, col) && isDark,
                    }"
                    @input="(event: any) => handleInputChange(row.role_name, moduleRow.module_name, moduleRow[col], col, event.target.innerText)"
                    @keypress="restrictToNumbers"
                    @paste="preventNonNumericPaste"
                    class="inline-block px-2 py-0.5"
                  >
                    {{ changedValues[moduleRow.module_name]?.[col] ?? moduleRow[col] }}
                  </div>
                </span>
              </div>
            </template>
            <div v-if="isRoleLimitsLoading" class="h-[50vh] flex justify-center items-center">
              <OSpinner size="md" />
            </div>
          </template>
        </OTable>
      </div>
      <div
        class="bg-card-glass-bg flex-1 min-h-0"
        v-if="activeTab == 'role-limits' && activeType == 'json'"
      >
        <query-editor
          data-test="json-view-roles-editor"
          ref="queryEditorRef"
          editor-id="json-view-roles-editor"
          :debounceTime="300"
          v-model:query="jsonStrToDisplay"
          language="json"
          class="h-full"
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
        <OSpinner size="md" />
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
        class="flex justify-end w-full ml-auto sticky bottom-0 top-0 z-1 mt-auto pr-3 py-2 gap-2 border-t border-border-default bg-surface-base"
        v-if="editTable && activeType == 'table'"
      >
        <OButton
          variant="outline"
          size="sm-action"
          @click="cancelChanges"
        >
          {{ t('iam.quotaPage.cancel') }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="Object.keys(changedValues).length === 0"
          @click="saveChanges"
        >
          {{ t('iam.quotaPage.save') }}
        </OButton>
      </div>
      <div
        class="flex justify-end w-full ml-auto sticky bottom-0 top-0 z-1 mt-auto pr-3 gap-2 border-t border-border-default bg-surface-base"
        v-if="editTable && activeType == 'json'"
      >
        <OButton
          variant="outline"
          size="sm-action"
          @click="cancelJsonChanges"
          :disabled="isSavingJson"
        >
          {{ t('iam.quotaPage.cancel') }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          @click="saveJsonChanges"
          :disabled="isSavingJson"
        >
          {{ isSavingJson ? t('iam.quotaPage.savingChanges') : t('iam.quotaPage.saveChanges') }}
        </OButton>
      </div>
    </div>

    <ConfirmDialog
      :title="t('iam.quotaPage.unsavedChangesDetected')"
      :message="t('iam.quotaPage.saveBeforeSwitchingTabs')"
      @update:ok="saveChangesAndTabSwitch"
      @update:cancel="discardChangesTabSwitch"
      v-model="showConfirmDialogTabSwitch"
    />
    <ConfirmDialog
      :title="t('iam.quotaPage.unsavedChangesDetected')"
      :message="t('iam.quotaPage.saveBeforeExpandingRow')"
      @update:ok="saveChangesAndRoleSwitch"
      @update:cancel="discardChangesRoleSwitch"
      v-model="showConfirmDialogRowSwitch"
    />
    <ConfirmDialog
      :title="t('iam.quotaPage.unsavedChangesDetected')"
      :message="t('iam.quotaPage.saveBeforeSwitchingType')"
      @update:ok="saveChangesAndTypeSwitch"
      @update:cancel="discardChangesTypeSwitch"
      v-model="showConfirmDialogTypeSwitch"
    />
  </OPageLayout>
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
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import organizationsService from "@/services/organizations";
import AppTabs from "@/components/common/AppTabs.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { getRoles } from "@/services/iam";
import ratelimitService from "@/services/rate_limit";
import { useRouter } from "vue-router";
import { getImageURL, getUUID } from "@/utils/zincutils";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

import useRateLimiter from "@/composables/useRateLimiter";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
export default defineComponent({
  name: "Quota",
  components: {
    NoOrganizationSelected,
    OButton,
    OSelect,
    OSearchInput,
    AppTabs,
    OPageLayout,
    ConfirmDialog,
    QueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    OEmptyState,
    OSpinner,
    OIcon,
    OTable,
},
  setup() {
    const { t } = useI18n();
    const selectedOrganization = ref<any>(null);
    const store = useStore();
    const { isDark } = useTheme();
    const organizations = ref<any[]>([]);
    const isOrgLoading = ref<boolean>(false);
    const resultTotal = ref<number>(0);
    const {
      getApiLimitsByOrganization,
      getRoleLimitsByOrganization,
      getModulesToDisplay,
      isRoleLimitsLoading,
      isApiLimitsLoading,
    } = useRateLimiter();
    const rolesLimitRows = ref<any[]>([]);
    const rolesColumns = ref<any[]>([]);
    const activeType = ref<any>("table");
    const activeTimeUnit = ref<string>("second");

    const tabs = ref<any[]>([
      {
        label: t("iam.quotaPage.apiLimits"),
        value: "api-limits",
        icon: "speed",
      },
      {
        label: t("iam.quotaPage.roleLimits"),
        value: "role-limits",
        icon: "shield",
      },
    ]);

    const timeUnitTabs = ref<any[]>([
      {
        label: t("iam.quotaPage.perSecond"),
        value: "second",
        icon: "timer",
      },
      {
        label: t("iam.quotaPage.perMinute"),
        value: "minute",
        icon: "schedule",
      },
      {
        label: t("iam.quotaPage.perHour"),
        value: "hour",
        icon: "hourglass-empty",
      },
    ]);

    const typeTabs = computed(() => [
      {
        label: t("iam.quotaPage.table"),
        value: "table",
        icon: "table-chart",
      },
      {
        label: "JSON",
        value: "json",
        icon: "data-object",
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

    const apiLimitCrudColumnIds = computed(() =>
      apiLimitsColumns.value
        .filter((c) => c.id !== "module_name")
        .map((c) => c.id),
    );

    const roleLimitCrudColumnIds = computed(() =>
      roleLimitsColumns.value
        .filter((c) => c.id !== "role_name")
        .map((c) => c.id),
    );

    const apiLimitsColumns = computed<OTableColumnDef[]>(() => {
      const unitLabel = getTimeUnitLabel();
      return [
        {
          id: "module_name",
          header: t("quota.moduleName"),
          accessorKey: "module_name",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.name,
          minSize: 160,
          meta: { align: "left", flex: true },
        },
        {
          id: "list",
          header: `${t("quota.listLimit")} ${unitLabel}`,
          accessorKey: "list",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
        },
        {
          id: "get",
          header: `${t("quota.getLimit")} ${unitLabel}`,
          accessorKey: "get",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
        },
        {
          id: "create",
          header: `${t("quota.createLimit")} ${unitLabel}`,
          accessorKey: "create",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
        },
        {
          id: "update",
          header: `${t("quota.updateLimit")} ${unitLabel}`,
          accessorKey: "update",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
        },
        {
          id: "delete",
          header: `${t("quota.deleteLimit")} ${unitLabel}`,
          accessorKey: "delete",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
        },
      ];
    });
    const roleLimitsColumns = computed<OTableColumnDef[]>(() => {
      const unitLabel = getTimeUnitLabel();
      return [
        {
          id: "role_name",
          header: t("quota.roleName"),
          accessorKey: "role_name",
          sortable: true,
          resizable: true,
          hideable: true,
          cell: (info: any) => info.getValue(),
          size: COL.role,
          minSize: 160,
          meta: { align: "left", flex: true },
        },
        {
          id: "list",
          header: `${t("quota.listLimit")} ${unitLabel}`,
          accessorKey: "list",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
        },
        {
          id: "get",
          header: `${t("quota.getLimit")} ${unitLabel}`,
          accessorKey: "get",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
        },
        {
          id: "create",
          header: `${t("quota.createLimit")} ${unitLabel}`,
          accessorKey: "create",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
        },
        {
          id: "update",
          header: `${t("quota.updateLimit")} ${unitLabel}`,
          accessorKey: "update",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
        },
        {
          id: "delete",
          header: `${t("quota.deleteLimit")} ${unitLabel}`,
          accessorKey: "delete",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
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
        const newArray = [...organizations.value];
        newArray.unshift({
          label: t("iam.quotaPage.globalRules"),
          value: "global_rules",
        });
        return newArray;
      } else {
        return organizations.value;
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
          toast({
            variant: "success",
            message: response.data.message,
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
        toast({
          variant: "error",
          message:
            error.response.data.message ||
            t("iam.quotaPage.errorUpdatingRateLimits"),
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
          toast({
            variant: "success",
            message: response.data.message,
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
        toast({
          variant: "error",
          message:
            error.response.data.message ||
            t("iam.quotaPage.errorUpdatingRateLimits"),
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
        const dismiss = toast({
          variant: "loading",
          message: t("iam.quotaPage.uploadingRules"),
          timeout: 0,
        });
        uploadingRules.value = true;
        const response = await ratelimitService.upload_template(
          selectedOrganization.value.value,
          combinedJson,
        );
        if (response.status === 200) {
          toast({
            variant: "success",
            message: response.data.message,
          });
        }
        uploadingRules.value = false;
        isBulkUpdate.value = false;
        uploadedRules.value = null;
        await getApiLimitsByOrganization(selectedOrganization.value.value);
        dismiss();
      } catch (error) {
        uploadingRules.value = false;
        uploadError.value = t("iam.quotaPage.errorUploadingRules");
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
                toast({
                  message: t("iam.quotaPage.errorParsingJson", { name: file.name }),
                  variant: "error",
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
    const triggerExpand = async (row: any) => {
      if (Object.keys(changedValues.value).length > 0) {
        showConfirmDialogRowSwitch.value = true;
        toBeExpandedRow.value = row;
        return;
      }
      expandedRole.value = row.role_name;
      if (expandedRow.value === row.uuid) {
        expandedRow.value = null;
        openedRole.value = null;
      } else {
        openedRole.value = row.role_name;
        //expand the row at first only because we need to show the loading state for the user
        expandedRow.value = row.uuid;
        if (
          !store.state.allRoleLimitsByOrgIdByRole[
            selectedOrganization.value.value
          ]?.[row.role_name]
        ) {
          roleLevelModuleRows.value = await getRoleLimitsByOrganization(
            selectedOrganization.value.value,
            row.role_name,
            activeTimeUnit.value,
          );
        } else {
          roleLevelModuleRows.value =
            store.state.allRoleLimitsByOrgIdByRole[
              selectedOrganization.value.value
            ][row.role_name];
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
            toast({
              variant: "error",
              message: t("iam.quotaPage.someValuesEmpty"),
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
    const handleExpandedChange = (ids: string[]) => {
      const newId = ids?.[0] ?? null;
      if (newId === expandedRow.value) return;
      if (newId) {
        const row = rolesLimitRows.value.find((r: any) => r.uuid === newId);
        if (row) triggerExpand(row);
      } else {
        expandedRow.value = null;
        openedRole.value = null;
      }
    };
    const handleOrgSelect = async (val: any) => {
      if (!organizationToDisplay.value.length) {
        selectedOrganization.value = null;
        return;
      }
      selectedOrganization.value = organizationToDisplay.value.find((o: any) => o.value === val) ?? null;
      if (!selectedOrganization.value) return;
      await updateOrganization();
    };
    const handleApiCategorySelect = (val: any) => {
      selectedApiCategory.value = apiCategories.value.find((o: any) => o.value === val) ?? null;
      filterModulesBasedOnCategory();
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
        toast({
          variant: "warning",
          message: t("iam.quotaPage.saveBeforeSwitchingTimeUnits"),
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
      isDark,
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
      rolesLimitRows,
      rolesColumns,
      apiLimitsRows,
      apiLimitsColumns,
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
      outlinedFileDownload: "file-download",
      outlinedFileUpload: "file-upload",
      uploadedRules,
      outlinedInsertDriveFile: "insert-drive-file",
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
      roleLimitsColumns,
      triggerExpand,
      expandedRow,
      roleLevelModuleRows,
      roleLevelLoading,
      getRoleLimitsByOrganization,
      selectedApiCategory,
      handleOrgSelect,
      handleApiCategorySelect,
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
      apiLimitCrudColumnIds,
      roleLimitCrudColumnIds,
      handleExpandedChange,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override): hide number-input spinners + center non-first OTable sort-trigger headers (child DOM) */
.quota-page :deep(input[type="number"]::-webkit-outer-spin-button),
.quota-page :deep(input[type="number"]::-webkit-inner-spin-button) {
  -webkit-appearance: none;
  margin: 0;
}

.quota-page :deep(th:not([data-test="o2-table-th-module_name"]):not([data-test="o2-table-th-role_name"]) [data-test="o2-table-th-sort-trigger"]) {
  justify-content: center;
}
</style>
