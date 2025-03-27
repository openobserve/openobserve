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

<template>
      <q-page class=" quota-page text-left"
        :class="store.state.theme === 'dark' ? 'dark-theme-page' : 'light-theme-page'"
       style="min-height: inherit">
        <div :style="{ height: '100%', marginTop: 0 }" class="app-table-container" >
            <div class="q-mx-md">
                <div
                    class="q-table__title full-width "
                    data-test="user-title-text"
                >
                    {{ t("quota.header") }}
                </div>
                <div class="flex items-center justify-between full-width q-mb-sm">
                    <div class="flex items-center ">
                    <q-select
                    :loading="isOrgLoading"
                    v-model="selectedOrganization"
                    :options="filteredOrganizations"
                    @filter="filterOrganizations"
                    placeholder="Select Org"
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
                    <div
                        v-if="selectedOrganization"
                     class="quota-tabs">
                        <q-tabs
                        data-test="quota-tabs"
                        :model-value="activeTab"
                        no-caps
                        outside-arrows
                        size="sm"
                        mobile-arrows
                        class="bg-white text-primary"
                        @update:model-value="updateActiveTab"
                         >
                        <q-tab
                        data-test="quota-api-limit-tab"
                        name="api-limits"
                        :label="t('quota.api-limits')"
                        />
                        <q-tab
                        data-test="quota-role-limit-tab"
                        name="role-limits"
                        :label="t('quota.role-limits')"
                        />
                    </q-tabs>
                    </div>
                    </div>
                    <div  class="flex items-center" v-if="selectedOrganization">
                     <!-- this is bulk update and it is deprecated feature not needed -->

                        <q-btn
                            data-test="bulk-update-btn"
                            label="Bulk Update"
                            class="border q-ml-md title-height"
                            no-caps
                            @click="bulkUpdate"
                            v-if="false"
                        >
                        <q-icon name="cached" style="font-weight: 200; opacity: 0.7;"  class="q-ml-sm"/>
                    </q-btn>

                       

                    <!-- this is edit quota and it is needed -->
                        <q-btn
                        v-if="!editTable"
                            data-test="edit-table-btn"
                            label="Edit Quota"
                            class="border q-mr-md title-height"
                            no-caps

                            @click="editTableWithInput"
                        >
                        <q-icon name="edit" style="font-weight: 200; opacity: 0.7;"  class="q-ml-sm"/>
                    </q-btn>


                    </div>

                </div>
                <div class="flex items-center justify-between full-width q-mb-sm">
                <div v-if="selectedOrganization && activeType == 'table'" class="flex items-center ">
                    <q-input
                        data-test="pipeline-list-search-input"
                        v-model="searchQuery"
                        borderless
                        filled
                        dense
                        class=" no-border input-width"
                        :placeholder="{
                            'api-limits': t('quota.api-search'),
                            'role-limits': t('quota.role-search')
                        }[activeTab]"
                    >
                        <template #prepend>
                        <q-icon name="search" class="cursor-pointer" />
                        </template>
                    </q-input>
                    <q-select
                        v-if="activeTab == 'role-limits'"
                        :loading="isRoleModulesLoading"
                        v-model="selectedRole"
                        :options="filteredRolesToDisplayOptions"
                        placeholder="Select Api Category"
                        color="input-border"
                        style="padding: 0px;"
                        bg-color="input-bg"
                        class=" no-case q-mr-md input-width q-ml-md category-select"
                        stack-label
                        outlined
                        filled
                        dense
                        use-input
                        hide-selected
                        fill-input                    
                        clearable
                        @filter="filterRolesToDisplayOptions"
                        @update:model-value="updateSelectedRole()"
                  >
                    </q-select>
                 </div>
                 <div
                 v-if="selectedOrganization"

                  class="quota-tabs float-right q-ml-auto">
                        <q-tabs
                        data-test="table-json-type-selection-tabs"
                        :model-value="activeType"
                        no-caps
                        outside-arrows
                        size="sm"
                        mobile-arrows
                        class="bg-white text-primary"
                        @update:model-value="updateActiveType"
                        >
                        <q-tab
                        data-test="table-json-type-selection-tab"
                        name="table"
                        :label="t('quota.table')"
                        />
                        <q-tab
                        :disable=" activeTab == 'role-limits' && !expandedRow"
                        data-test="table-json-type-selection-tab"
                        name="json"
                        :label="t('quota.json')"
                        />
                    </q-tabs>
                    </div>
                </div>
            </div>

            <q-table
            :rows="apiLimitsRows"
            :columns="generateColumns()"
            row-key="name"
            :pagination="pagination"
            :filter="searchQuery"
            :filter-method="filteredData"
            v-if="activeTab == 'api-limits' && activeType == 'table'"
            dense
            class="q-mx-md"
        >
        <template v-slot:header="props">
            <q-tr  :props="props" class="thead-sticky ">
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

            <template v-slot:body-cell="props">
            <q-td  :props="props" v-if="editTable" 
            :style="{
                    backgroundColor: editTable && props.col.name !== 'module_name' ? store.state.theme === 'dark' ? '#212121' : '#f1f1ee' : 'transparent',
                    }"
             >
                <div v-if="props.col.name != 'module_name' && props.row[props.col.name] != '-'" contenteditable="true"
                debounce="500"
                :class="{
                    'editable-cell': editTable && props.col.name !== 'module_name',
                    'edited-input': isEdited(props.row.module_name, props.col.name)
                }"
                @input="(event: any) => handleInputChange(props.row.module_name , props.row[props.col.name], props.col.name, event.target.innerText)"
                 @keypress="restrictToNumbers"
                @paste="preventNonNumericPaste"
                >
                    {{ changedValues[props.row.module_name]?.[props.col.name] ?? props.row[props.col.name]}}
                </div>
                    <div v-else-if="props.col.name == 'module_name'"> 
                    {{ props.row[ props.col.name ] }}
                </div>
                <div
                 :disabled="true" v-else-if="props.row[props.col.name] == '-'">
                   -
                </div>
            </q-td>
            <q-td  :props="props" v-else>
                <div v-if="props.col.name != 'module_name' && props.row[props.col.name] != '-'">
                    {{ props.row[ props.col.name ] }}
                </div>
                    <div v-else-if="props.col.name == 'module_name'"> 
                    {{ props.row[ props.col.name ] }}
                </div>
                <div v-else-if="props.row[props.col.name] == '-'">
                   -
                </div>
            </q-td>
            </template>
        </q-table>
        <div class="q-mt-md" v-if="activeTab == 'api-limits'  && activeType == 'json'" style="height: calc(100vh - 245px); ">
           <!-- here add the queryeditor -->
           <query-editor
                data-test="json-view-roles-editor"
                ref="queryEditorRef"
                editor-id="json-view-roles-editor"
                class="monaco-editor"
                :debounceTime="300"
                v-model:query="jsonStrToDisplay"
                language="json"
                style="height: 100%;"
                :read-only="!editTable"
              />
        </div>
        <q-table
          :rows="rolesLimitRows"
          :columns="roleLimitsColumns"
          row-key="name"
          :pagination="pagination"
          :filter="searchQuery"
          :filter-method="filteredData"
          dense
          v-if="activeTab == 'role-limits' && activeType == 'table'"
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

      <q-td v-for="col in roleLimitsColumns" :key="col.name" :props="props" :style="col.style">
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
          <template v-else>
            
          </template>
          
      </q-td>
      </q-tr>
      <q-tr v-if="!editTable && !roleLevelLoading" v-for="(row,index) in filteredRoleLevelModuleRows" data-test="scheduled-pipeline-row-expand" v-show="expandedRow === props.row.uuid" :props="props" >
          <q-td v-for="col in props.cols" :key="col.name" :props="props">
           <template v-if="col.name == 'role_name'">
            <div style="padding-left: 20px;">
                {{ row['module_name'] }}
            </div>
           </template>
           <template v-else-if="col.name == '#'"> 
            {{}}
           </template>
           <template v-else-if="row[col.name] == '-'">
            -
        </template>
           <template v-else> 
            {{ row[col.name] }}
           </template>

          </q-td>
     </q-tr>
     <q-tr v-if="editTable && !roleLevelLoading" v-for="(row,index) in filteredRoleLevelModuleRows" data-test="scheduled-pipeline-row-expand" v-show="expandedRow === props.row.uuid" :props="props" >
            <q-td
            :style="{
                    backgroundColor: editTable && col.name !== 'role_name' ? store.state.theme === 'dark' ? '#212121' : '#f1f1ee' : 'transparent',
                    }"

            
             :props="props" 
                 v-for="col in props.cols" :key="col.name" 
                  v-if="editTable"
                  style="padding-left: 8px ;">
                   <template v-if="col.name == 'role_name'">
                    <div style="padding-left: 20px;">
                        {{ row['module_name'] }}
                    </div>
                </template>
                <template v-else-if="col.name == '#'"> 
                    {{}}
                </template>
                <template v-else-if="row[col.name] == '-'">
                    -
                </template>
                <template v-else> 
                    <div
                    contenteditable="true"
                    debounce="500"
                    :class="{
                        'editable-cell': editTable && col.name !== 'module_name',
                        'edited-input': isEdited(row.module_name, col.name)
                    }"
                    @input="(event: any) => handleRoleInputChange(props.row.role_name , row.module_name , row[col.name], col.name, event.target.innerText)"
                    @keypress="restrictToNumbers"
                    @paste="preventNonNumericPaste"
                    >
                    {{ row[col.name] }}
                    </div>
                 
                </template>
            </q-td>
     </q-tr>

    </template>

      </q-table>
      <div class="q-mt-md" v-if="activeTab == 'role-limits' && activeType == 'json'" style="height: calc(100vh - 245px);">
           <!-- here add the queryeditor -->
           <query-editor
                data-test="json-view-roles-editor"
                ref="queryEditorRef"
                editor-id="json-view-roles-editor"
                class="monaco-editor"
                :debounceTime="300"
                v-model:query="jsonStrToDisplay"
                language="json"
                style="height: 100%;"
                :read-only="!editTable"
              />
        </div>
        <div v-if=" activeTab == 'api-limits' && loading && !apiLimitsRows.length" class="flex justify-center items-center">
            <q-spinner-hourglass color="primary" size="lg" />
        </div>
        <div v-else-if=" activeTab == 'api-limits' && !loading && !apiLimitsRows.length">

            <NoOrganizationSelected />
        </div>
        <div v-if=" activeTab == 'role-limits' && loading && !rolesLimitRows.length" class="flex justify-center items-center">  
            <q-spinner-hourglass color="primary" size="lg" />
        </div>
        <div v-else-if=" activeTab == 'role-limits' && !loading && !rolesLimitRows.length">
            <NoData />
        </div>
        <div class="flex justify-end w-full tw-ml-auto floating-buttons  q-pr-md"
            v-if="editTable && activeType == 'table'"
            >
            <q-btn
            label="Cancel"
            class="border q-ml-md title-height"
            no-caps
            @click="cancelChanges"
            />
            <q-btn
            label="Save Changes"
            class="text-bold no-border q-ml-md"
                :color="(Object.keys(changedValues).length > 0) ? 'secondary' : 'grey'"
                :disable="(Object.keys(changedValues).length === 0) "
                padding="sm md"
                no-caps
            @click="saveChanges"
            />
        </div>
        <div class="flex justify-end w-full tw-ml-auto floating-buttons  q-pr-md q-mt-md"
            v-if="editTable && activeType == 'json'"
            >
            <q-btn
            label="Cancel"
            class="border q-ml-md title-height"
            no-caps
            @click="cancelJsonChanges"
            :disable="isSavingJson"
            />
            <q-btn
            :label="isSavingJson ? 'Saving Changes...' : 'Save Changes'"
            class="text-bold no-border q-ml-md"
                color="secondary"
                padding="sm md"
                no-caps
            @click="saveJsonChanges"
            :disable="isSavingJson"

            />
        </div>
        

        <q-dialog v-model="isBulkUpdate">   
            <q-card style="height: 394px !important; width: 500px;"> 
                <q-card-section style="height: 100px !important;">
                    <div class="flex items-center justify-between">
                        <div class="text-h6">Bulk Update</div>
                        <q-btn icon="close" size="sm" flat dense @click="closeBulkUpdate" />
                    </div>
                    <div class="q-mt-xs"
                    :class="store.state.theme === 'dark' ? 'text-grey' : 'text-grey-9'"
                     >
                        To perform bulk updates, download the provided JSON file, edit the default values within it, and then re-upload the modified file back into the system.
                    </div>
                </q-card-section>

                <q-card-section style="height: 180px !important;" >
                   <div style="border: 1px solid #E0E0E0; border-radius: 2px;" class=" tw-border tw-border-solid tw-border-grey   full-width full-height q-mt-sm">

                    <div  class="flex justify-center items-center full-width full-height">
                        <q-file
                        style="height: 100%  !important;  z-index: 1000;"
                        v-model="uploadedRules"
                        accept=".json"
                        label="Upload JSON file"
                        multiple
                        class=" full-height full-width cursor-pointer file-upload-input tw-border tw-border-solid tw-border-grey "
                        borderless
                        >
                        <template v-slot:label >
                            <div v-if="!uploadedRules" class="flex full-width full-height items-center " style="flex-direction: column;">   
                                <q-img :src="getImageURL('images/common/hard-drive.svg')" style="width: 48px; height: 48px;" />
                                <div class="q-mt-md">
                                    <div class=" flex text-center full-width items-center justify-center q-mt-sm" :class="store.state.theme === 'dark' ? 'text-white' : 'text-grey-9'">Click or drag the file to this area to upload</div>
                                    <div class="     flex text-center full-width items-center justify-center q-mt-sm" :class="store.state.theme === 'dark' ? 'text-grey-4' : 'text-grey-9'">Maximum file size: 2MB</div>
                                </div>
                            </div>
                        </template>
                        <template v-slot:file="scope" >
                            <div class="full-width full-height flex items-center justify-center">
                                {{ fileListToDisplay }}
                            </div>
                        </template>
                        </q-file>
                    </div>
                    
                        </div>
                        </q-card-section>
                <q-card-section style="height: 32px !important; padding-top: 0px !important;" >
                    <div style="background-color: #FFDEDE; color: #931B1E; border-radius: 5px;" v-if="uploadError && !uploadingRules" class="full-width  flex items-center q-py-xs  " >
                        <q-icon name="warning" class="q-mx-sm" style="color: #931B1E;" />{{ uploadError }}
                        <!-- error section / uploading notification section -->
                   </div>
                </q-card-section>
                <div>
                    <q-card-actions align="right"  >
                    <q-btn label="Update" class="text-bold" padding="sm md" no-caps  @click="uploadTemplate" :disable="uploadingRules" >
                        <q-icon :name="outlinedFileUpload" />
                    </q-btn>
                    <q-btn label="Download"  padding="sm md" no-caps  class="text-bold no-border "
                    style="border-radius: 8px !important;"
                  color="secondary"
                   @click="downloadTemplate" >
                        <q-icon :name="outlinedFileDownload" />
                    </q-btn>
                </q-card-actions>
                </div>
               
            </q-card>
        </q-dialog>
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
import { defineComponent, onMounted, reactive, ref, watch } from "vue";
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
import QueryEditor from "@/components/QueryEditor.vue";
import {
  outlinedDelete,
  outlinedPause,
  outlinedPlayArrow,

  outlinedFileDownload,
  outlinedFileUpload,
  outlinedInsertDriveFile
} from "@quasar/extras/material-icons-outlined";
import AppTable from "@/components/AppTable.vue";
import NoData from "@/components/shared/grid/NoData.vue";
export default defineComponent ({
    name: "Quota",
    components: {
        NoOrganizationSelected ,
        AppTabs,
        QTablePagination,
        ConfirmDialog,
        QueryEditor,
        NoData
    },
    setup() {
        const { t } = useI18n();
        const selectedOrganization = ref<any>(null);
        const store = useStore();
        const $q = useQuasar();
        const organizations = ref<any[]>([]);
        const isOrgLoading = ref<boolean>(false);
        const resultTotal = ref<number>(0);
        const perPageOptions = ref<number[]>([10, 20, 50, 100]);
        const pagination: any = ref({
            rowsPerPage: 20,
            });
        const rolesLimitRows = ref<any[]>([]);
        const rolesColumns = ref<any[]>([]);
        const activeType = ref<any>("table");
        const tabs = ref<any[]>([
            {
                label: "API Limits",
                value: "api-limits"
            },
            {
                label: "Role Limits",
                value: "role-limits"
            }
        ]);
        const apiLimitsColumns: any = [
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
                label: t("quota.listLimit"),
                align: "center",
                sortable: true,
                style: 'width: 200px !important; '
            },
            {
                name: "get",
                field: "get",
                label: t("quota.getLimit"),
                align: "center",
                sortable: true,
                style: 'width: 200px !important; '
            },
            {
                name: "create",
                field: "create",
                label: t("quota.createLimit"),
                align: "center",
                sortable: true,
                style: 'width: 200px !important; '
            },
            {
                name: "update",
                field: "update",
                label: t("quota.updateLimit"),
                align: "center",
                sortable: true,
                style: 'width: 200px !important; '
            },
            {
                name: "delete",
                field: "delete",
                label: t("quota.deleteLimit"),
                align: "center",
                sortable: true,
                style: 'width: 200px !important; '
            }
            ];
            const roleLimitsColumns: any = [
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
                label: t("quota.listLimit"),
                align: "center",
                sortable: true,
                style: 'width: 200px !important; '
            },
            {
                name: "get",
                field: "get",
                label: t("quota.getLimit"),
                align: "center",
                sortable: true,
                style: 'width: 200px !important; '
            },
            {
                name: "create",
                field: "create",
                label: t("quota.createLimit"),
                align: "center",
                sortable: true,
                style: 'width: 200px !important; '

            },
            {
                name: "update",
                field: "update",
                label: t("quota.updateLimit"),
                align: "center",
                sortable: true,
                style: 'width: 200px !important; '
            },
            {
                name: "delete",
                field: "delete",
                label: t("quota.deleteLimit"),
                align: "center",
                sortable: true,
                style: 'width: 200px !important; '
            }
            ];
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
        const selectedRole = ref<any>(null);
        const rolesToBeDisplayed = ref<any[]>([]);
        const isRoleModulesLoading = ref<boolean>(false);
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
        const filteredRolesToDisplayOptions = ref<any[]>([]);

        onMounted(async ()=>{
            await getOrganizations();
            if(router.currentRoute.value.query.quota_org){
                selectedOrganization.value = {
                    label: router.currentRoute.value.query.quota_org,
                  
                    value: router.currentRoute.value.query.quota_org
                }
            }
            if(selectedOrganization.value){
                await getApiLimitsByOrganization();
            }

        })

        //watch here

        watch (()=>uploadedRules.value, (newVal) => {
            if(!newVal || newVal.length == 0){
                fileListToDisplay.value = '';
                return;
            }
            fileListToDisplay.value = '';
            if(newVal.length > 1){
            newVal.forEach((file: any) => {
                fileListToDisplay.value += file.name + ',';
            });
        }
        else{
            fileListToDisplay.value = newVal[0].name;
        }


        })
        const updateOrganization = () => {
            router.push({
                ...router.currentRoute.value,
                query: {
                    ...router.currentRoute.value.query,
                    quota_org: selectedOrganization.value.value.toLowerCase(),
                }
            })
            if(activeTab.value === "api-limits"){
                getApiLimitsByOrganization();
            }
            else{
                getRolesByOrganization();
            }
        }
        const getOrganizations = async () => {
            if(store.state.organizations.length === 0){
                try{
                    isOrgLoading.value = true;
                    const response = await organizationsService.os_list(0, 100000, "id", false, "", "default")
                    organizations.value = response.data.data.map((org: any) => ({
                        label: org.name,
                        value: org.identifier
                    }));
                    isOrgLoading.value = false;
                }
                catch(error){
                    isOrgLoading.value = false;
                    console.log(error);
                }
                finally{
                    isOrgLoading.value = false;
    
                }
            }
            else{
                organizations.value = store.state.organizations.map((org: any) => ({
                    label: org.name,
                    value: org.identifier
                }));

            }
            organizations.value.unshift({
                label: "GLOBAL RULES META",
                value: "GLOBAL_RULES_META"
            });
        }
        const updateActiveTab = (tab: string) => {
            let isChanged = Object.keys(changedValues.value).length > 0;

            if (isChanged) {
                nextTab.value = tab; // Store the tab user wants to switch to
                showConfirmDialogTabSwitch.value = true; // Show confirmation dialog
            } else {
                switchTab(tab);
            }
        };

        const switchTab = async (tab: string) => {
            activeType.value = 'table'
            activeTab.value = tab;

            // Load data if needed
            if (tab === "role-limits" && roleLevelModuleRows.value.length === 0 && rolesLimitRows.value.length === 0) {
                await getRolesByOrganization();
                await getModulesToDisplay();
            }
            if (tab === "api-limits") {
                await getApiLimitsByOrganization();
            }
        };

    const saveChangesAndTabSwitch = async () => {
        await saveChanges();
        changedValues.value = {};
        editTable.value = false;
        if (nextTab.value) {
            switchTab(nextTab.value);
            nextTab.value = null;
        }
        showConfirmDialogTabSwitch.value = false;
    };

    const discardChangesTabSwitch = () => {
        changedValues.value = {};
        editTable.value = false;
        if (nextTab.value) {
            switchTab(nextTab.value);
            nextTab.value = null;
        }
        showConfirmDialogTabSwitch.value = false;
    };


        const bulkUpdate = () => {
            isBulkUpdate.value = true;
        }
        const saveBulkUpdate = () => {
            console.log('save bulk update')
        }
        const editTableWithInput = () => {
            editTable.value = true;
        }
        const changePagination = (page: number, perPage: number) => {

        }
        const generateRolesColumns = () => {
            rolesColumns.value = [
                {
                    name: "name", label: "Name", field: "name"
                }
            ]
        }
        const getRolesByOrganization = async () => {
            try{
                const response = await getRoles(selectedOrganization.value?.value);
                rolesLimitRows.value = response.data.map((role: any) => ({
                    role_name: role,
                    uuid: getUUID(),
                    list: 10,
                    get: 10,
                    create: 10,
                    update: 10,
                    delete: 10
                }));
                console.log(rolesLimitRows.value,'rolesLimitRows');
            }
            catch(error){
                console.log(error);
            }
        }
        const getApiLimitsByOrganization = async () => {
            loading.value = true;
            changedValues.value = {};
            editTable.value = false;
            try {
                const response = await ratelimitService.getApiLimits(selectedOrganization?.value?.value);
                let transformedData: any = [];

            //predefined operation that we get from the api
            const operations = ['list', 'get', 'create', 'update', 'delete'];
            // Iterate over each module in api_group_info
            Object.keys(response.data).forEach((moduleName) => {
                const module = response.data[moduleName];

                // Create an object to store the threshold values for each operation
                let moduleThresholds: any = {
                    module_name: moduleName,
                };

                operations.forEach((operation) => {
                    // Check if the operation exists for the current module
                    if (module[operation.toLowerCase()] !== undefined) {
                        // If the operation exists, get the threshold value
                        moduleThresholds[operation.toLowerCase()] =  module[operation.toLowerCase()];
                    } else {
                        // If the operation doesn't exist, set it as '--'
                        moduleThresholds[operation.toLowerCase()] = '-';
                    }
                });
                // Add the transformed data to the array
                transformedData.push(moduleThresholds);

            });
            transformedData.sort((a: any, b: any) => a.module_name.localeCompare(b.module_name));
            apiLimitsRows.value = transformedData;
            resultTotal.value = transformedData.length;
            loading.value = false;
        } catch (error) {
            loading.value = false;
            console.log(error);
        }
        finally{
            loading.value = false;
        }
        };
        const getRoleLimitsByOrganization = async (rolename: string) => {
            roleLevelLoading.value = true;
            changedValues.value = {};
            editTable.value = false;
            try {
                const response = await ratelimitService.getRoleLimits(selectedOrganization.value.value, rolename);
                let transformedData: any = [];

            //predefined operation that we get from the api
            const operations = ['list', 'get', 'create', 'update', 'delete'];
            // Iterate over each module in api_group_info
            Object.keys(response.data).forEach((moduleName) => {
                const module = response.data[moduleName];

                // Create an object to store the threshold values for each operation
                let moduleThresholds: any = {
                    module_name: moduleName,
                };

                operations.forEach((operation) => {
                    // Check if the operation exists for the current module
                    if (module[operation.toLowerCase()] !== undefined) {
                        // If the operation exists, get the threshold value
                        moduleThresholds[operation.toLowerCase()] =  module[operation.toLowerCase()];
                    } else {
                        // If the operation doesn't exist, set it as '--'
                        moduleThresholds[operation.toLowerCase()] = '-';
                    }
                });
                // Add the transformed data to the array
                transformedData.push(moduleThresholds);

            });
            transformedData.sort((a: any, b: any) => a.module_name.localeCompare(b.module_name));
            roleLevelModuleRows.value = transformedData;
            if(selectedRole.value?.value){
                filteredRoleLevelModuleRows.value = transformedData.filter((row: any) => row.module_name.toLowerCase() === selectedRole.value?.value.toLowerCase());
            }
            else{
                filteredRoleLevelModuleRows.value = transformedData;
            }
            resultTotal.value = transformedData.length;
            roleLevelLoading.value = false;
        } catch (error) {
            roleLevelLoading.value = false;
            console.log(error);
        }
        finally{
            roleLevelLoading.value = false;
        }
        };

        

    const handleInputChange = (moduleName: string, row: any, operation: string, value: any) => {
                    // Remove non-numeric characters except "."
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
            changedValues.value[moduleName] = reactive ({});
            }
            changedValues.value[moduleName][operation] = cleanedValue;

            let valueToUpdate ;

            if(isNaN(parseInt(value))){
                valueToUpdate = ""
            }
        else{
            valueToUpdate = parseInt(value);
        }
        changedValues.value[moduleName][operation] = valueToUpdate;

        //this is deprecated code 
        // if(row.rule){
        //     const rowRule = row.rule;
        //     rowRule.threshold = parseInt(value);
        //     changedValues.value[moduleName][operation] = {
        //         ...rowRule
        //     };
        // }
        // else{
        //     //handle the case where the rules are not there in the row
        //     delete row.rule;
        //     delete row.api_set
        //     delete row.global_default_rule
        //     row.rule_type = 'exact'
        //     row.user_role = ".*"
        //     row.user_id = ".*"
        //     row.threshold = parseInt(value);
        //     row.org = selectedOrganization.value.value;
        //     changedValues.value[moduleName][operation] = {
        //         ...row
        //     };

        // }

    };
    const restrictToNumbers = (event: any) => {
    const char = String.fromCharCode(event.keyCode);

    // Allow numbers, backspace, delete, tab, enter, and decimal point
    if (!/[0-9.]/.test(char) && ![8, 46, 9, 13].includes(event.keyCode)) {
        event.preventDefault();
    }
    };
    const handleRoleInputChange =  (roleName: any, moduleName: string, row: any, operation: string, value: any) => {
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
            changedValues.value[moduleName] = reactive ({});
            }
            changedValues.value[moduleName][operation] = cleanedValue;

            let valueToUpdate ;

            if(isNaN(parseInt(value))){
                valueToUpdate = ""
            }
            else{
            valueToUpdate = parseInt(value);
            }
            changedValues.value[moduleName][operation] = valueToUpdate;

        // row.user_role = roleName;
        // if(row.rule){
        //     const rowRule = row.rule;
        //     rowRule.threshold = parseInt(value);
        //     changedValues.value[moduleName][operation] = {
        //         ...rowRule
        //     };
        // }
        // else{
        //     //handle the case where the rules are not there in the row
        //     delete row.rule;
        //     delete row.api_set
        //     delete row.global_default_rule
        //     row.rule_type = 'exact'
        //     row.user_id = ".*"
        //     row.threshold = parseInt(value);
        //     row.org = selectedOrganization.value.value;
        //     changedValues.value[moduleName][operation] = {
        //         ...row
        //     };
        // }

    };

    const saveChanges = async () => {
        try {
            if(!validateChanges(changedValues.value)){
                return;
            }
            let payload: any = {};
            payload = {...changedValues.value};
            let user_role = expandedRole.value;
            let response  = null;
            if(activeTab.value === "api-limits"){
                response = await ratelimitService.update_batch(selectedOrganization.value.value, payload,"module");
            }
            else{
                response = await ratelimitService.update_batch(selectedOrganization.value.value, payload,"role",user_role);
            }
            // Here you would call your API to save the changes
            if(response.status === 200){
                uploadError.value = '';
                uploadedRules.value = [];
                isBulkUpdate.value = false;
                $q.notify({
                    type: "positive",
                    message: response.data.message,
                    timeout: 3000,
                })
            }
        
        // After successful save, refresh the data
        editTable.value = false;
        if(activeTab.value === "api-limits"){
                await getApiLimitsByOrganization();
            }
            else{
                await getRoleLimitsByOrganization(openedRole.value);
            }
        changedValues.value = {};
    } catch (error: any) {
        $q.notify({
            type: "negative",
            message: error.response.data.message || "Error while updating rate limits rule",
            timeout: 3000,
        })
        console.error('Error saving changes:', error);
    }
    };

    const cancelChanges = () => {
        console.log('cancelChanges')
        changedValues.value = {};
        editTable.value = false;
    };

    const cancelJsonChanges = () => {
        console.log('cancelJsonChanges')
        changedValues.value = {};
        editTable.value = false;
    };

    const saveJsonChanges = async () => {
        try {
            isSavingJson.value = true;
            let user_role = expandedRole.value;
            const payload = JSON.parse(jsonStrToDisplay.value);
            let response  = null;
            if(activeTab.value === "api-limits"){
                response = await ratelimitService.update_batch(selectedOrganization.value.value, payload,"module");
            }
            else{
                response = await ratelimitService.update_batch(selectedOrganization.value.value, payload,"role",user_role);
            }
            // Here you would call your API to save the changes
            if(response.status === 200){
                $q.notify({
                    type: "positive",
                    message: response.data.message,
                    timeout: 3000,
                })
            }
        
        // After successful save, refresh the data
        editTable.value = false;
        if(activeTab.value === "api-limits"){
                await getApiLimitsByOrganization();
            }
            else{
                await getRoleLimitsByOrganization(openedRole.value);
            }
            isSavingJson.value = false;
    } catch (error: any) {
        isSavingJson.value = false;
        $q.notify({
            type: "negative",
            message: error.response.data.message || "Error while updating rate limits rule",
            timeout: 3000,
        })
        console.error('Error saving changes:', error);
    }

    };

    const isEdited = (moduleName: string, operation: string) => {
        return changedValues.value[moduleName] && changedValues.value[moduleName][operation] !== undefined;
    };

    const generateColumns = () => {
        if(selectedOrganization.value?.hasOwnProperty('value') && selectedOrganization.value.value != ''){
            return apiLimitsColumns;
        }
        else{
            return [];
        }
    }

    const downloadTemplate = async () => {
        try{
            const response = await ratelimitService.download_template(selectedOrganization.value.value);
            const blob = new Blob([response.data], { type: 'application/json' });
            const jsonData = JSON.stringify(response.data, null, 2);
            const url = window.URL.createObjectURL(new Blob([jsonData], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `rate_limit_template_${selectedOrganization.value.label}.json`;
            document.body.appendChild(a);
            a.click();
        }
        catch(error){
            console.log(error);
        }
    }

    const uploadTemplate = async () => {
        const combinedJson = await convertUploadRulesToJson(uploadedRules.value);
        try{
            const dismiss = $q.notify({
                spinner: true,
                message: "Please wait while uploading rules...",
                timeout: 1000,
            });
            uploadingRules.value = true;
            const response = await ratelimitService.upload_template(selectedOrganization.value.value, combinedJson);
            if(response.status === 200){
                $q.notify({
                    type: "positive",
                    message: response.data.message,
                    timeout: 3000,
                })
            }
            uploadingRules.value = false;
            isBulkUpdate.value = false;
            uploadedRules.value = null;
            await getApiLimitsByOrganization();
            dismiss();
        }
        catch(error){
            uploadingRules.value = false;
            uploadError.value = "Error while uploading rules";
        }
        finally{
            uploadingRules.value = false;
        }
    }

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
                  const jsonArray = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
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
            console.error('Error reading file:', error);
          }
        }
        return combinedJson;
    }
    const closeBulkUpdate = () => {
        isBulkUpdate.value = false;
        uploadedRules.value = null;
        uploadError.value = '';
    }
    const onFocus = (row: any) => {
        focusedInputId.value = generateUniqueId(row);
    };

    // Handle blur event and clear the focused input ID
    const onBlur = () => {
    };

    const generateUniqueId = (row: any) => {
        return row.api_group_name + '_' + row.api_group_operation;
    }

    const filteredData = (rows: any, terms: any) => {
        var filtered = [];
        terms = terms.toLowerCase();
        if(activeTab.value === "api-limits"){
            for (var i = 0; i < rows.length; i++) {
                if(rows[i].module_name.toLowerCase().includes(terms)){
                    filtered.push(rows[i]);
                }
            }
        }
        else{
            for (var i = 0; i < rows.length; i++) {
                if(rows[i].role_name.toLowerCase().includes(terms)){
                    filtered.push(rows[i]);
                }
            }
        }

        return filtered;
      }
      const triggerExpand = async (props : any) =>{
        if(Object.keys(changedValues.value).length > 0){
            showConfirmDialogRowSwitch.value = true;
            toBeExpandedRow.value = props.row;
            return;
        }
        expandedRole.value = props.row.role_name;
        if (expandedRow.value === props.row.uuid) {
            expandedRow.value = null;
            openedRole.value = null;
            } 
        else {
            openedRole.value = props.row.role_name;
            await getRoleLimitsByOrganization(props.row.role_name);
        // Otherwise, expand the clicked row and collapse any other row
            expandedRow.value = props.row.uuid;
        }
    }
    const updateSelectedRole = () => {
        if(selectedRole.value?.value){
            filteredRoleLevelModuleRows.value = roleLevelModuleRows.value.filter((row: any) => row.module_name.toLowerCase() === selectedRole.value?.value.toLowerCase());
        }
        else{
            filteredRoleLevelModuleRows.value = roleLevelModuleRows.value;
        }
    }   

    const getModulesToDisplay = async () => {
        try {
            isRoleModulesLoading.value = true;
        const response = await ratelimitService.getModules(selectedOrganization.value.value);

        rolesToBeDisplayed.value = response.data.map((role: any) => ({
                label: role,
                value: role
            }));
            isRoleModulesLoading.value = false;
        } catch (error) {
            isRoleModulesLoading.value = false;
        }


    }
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
                if(changedValues[moduleName][operation] === ""){
                    $q.notify({
                        type: "negative",
                        message: "some values are empty please check",
                        timeout: 3000,
                    })
                    isEmpty = true;
                }
            })
        })
        if(isEmpty){
            return false;
        }
        return true;
    }
    const saveChangesAndRoleSwitch = async () => {
        await saveChanges();
        showConfirmDialogRowSwitch.value = false;
        if(toBeExpandedRow.value){
            console.log(toBeExpandedRow.value,'toBeExpandedRow')
            const index = rolesLimitRows.value.findIndex((row: any) => row.role_name === toBeExpandedRow.value.role_name);
            console.log(index,'index')
            console.log(rolesLimitRows.value[index],'row')
            expandedRow.value = rolesLimitRows.value[index].uuid;
            toBeExpandedRow.value = null;
        }
    }
    const discardChangesRoleSwitch = () => {
        showConfirmDialogRowSwitch.value = false;
    }
    const transformData = (data: any) => {
        return data.reduce((acc: any, item: any) => {
            // Convert module_name to snake_case
            const key = item.module_name

        // Remove keys with "-" values
        const filteredItem = Object.fromEntries(
            Object.entries(item).filter(([k, v]) => k !== "module_name" && v !== "-")
        );

        // Assign the cleaned object to the transformed key
        acc[key] = filteredItem;
        return acc;
    }, {});
};
    const updateActiveType = (type: string) => {
        if(type == 'json'){
            let isChanged = Object.keys(changedValues.value).length > 0;
            if(isChanged && editTable.value){
                nextType.value = type.toLowerCase();
                showConfirmDialogTypeSwitch.value = true;
            }
            else{
                activeType.value = type.toLowerCase();
                editTable.value = false
                populateJsonStr();
            }
        }
        else{
            let isChanged = jsonDiff(jsonStrToDisplay.value, transformData(apiLimitsRows.value));
            if(isChanged && editTable.value){
                nextType.value = type.toLowerCase();
                showConfirmDialogTypeSwitch.value = true;
            }
            else{
                activeType.value = type.toLowerCase();
                editTable.value = false
            }
        }
    }

    const populateJsonStr = () => {
        if(activeTab.value == 'api-limits'){
            jsonStrToDisplay.value = JSON.stringify(transformData(apiLimitsRows.value), null, 2);
        }
        else{
            jsonStrToDisplay.value = JSON.stringify(transformData(roleLevelModuleRows.value), null, 2);
        }
    }
    const saveChangesAndTypeSwitch = async () => {
        await saveChanges();
        editTable.value = false
        populateJsonStr();
        showConfirmDialogTypeSwitch.value = false;
        activeType.value = nextType.value;
        nextType.value = null;
        changedValues.value = {};
    }
    const discardChangesTypeSwitch = () => {
        showConfirmDialogTypeSwitch.value = false;
        activeType.value = nextType.value;
        nextType.value = null;
        editTable.value = false
        changedValues.value = {};
        populateJsonStr();
    }
    const jsonDiff = (oldJson: any, newJson: any): boolean => {
        return JSON.stringify(oldJson) !== JSON.stringify(newJson);
    };
    const filterOrganizations = (val: any, update: any) => {
        console.log(val,'val')
        if(val.length > 0){
            update();
            filteredOrganizations.value = organizations.value.filter((org: any) => org.label.toLowerCase().includes(val.toLowerCase()));
        }
        else{
            update();
            filteredOrganizations.value = organizations.value;
        }
    }
    const filterRolesToDisplayOptions = (val: any, update: any) => {
        if(val.length > 0){
            update();
            filteredRolesToDisplayOptions.value = rolesToBeDisplayed.value.filter((role: any) => role.label.toLowerCase().includes(val.toLowerCase()));
        }
        else{
            update();
            filteredRolesToDisplayOptions.value = rolesToBeDisplayed.value;
        }
    }
        return {
            t,
            selectedOrganization,
            organizations,
            updateOrganization,
            isOrgLoading,
            activeTab,
            updateActiveTab ,
            tabs,
            bulkUpdate,
            editTable,
            searchQuery,
            changePagination,
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
            onBlur,
            generateUniqueId,
            filteredData,
            roleLimitsColumns,
            triggerExpand,
            expandedRow,
            handleRoleInputChange,
            roleLevelModuleRows,
            roleLevelLoading,
            getRoleLimitsByOrganization,
            selectedRole,
            rolesToBeDisplayed,
            isRoleModulesLoading,
            updateSelectedRole,
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
            filteredRolesToDisplayOptions,
            filterRolesToDisplayOptions
        }

    }
})
</script>

<style lang="scss" >

.quota-page {
    input[type=number]::-webkit-outer-spin-button,
    input[type=number]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
    }
.quota-tabs {
  border: 1px solid $primary;
  width: 200px;
  border-radius: 4px;
  overflow: hidden;
}
.quota-tabs {
  .q-tab--active {
    background-color: $primary;
    color: $white;
  }

  .q-tab__indicator {
    display: none;
  }

  .q-tab {
    height: 30px;
    min-height: 30px;
  }
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
    .floating-buttons{
        background-color: $dark;
    }
}
.light-theme-page {
    .floating-buttons{
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
        color: #2196F3; // blue text color for edited values
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
        color: #64B5F6; // lighter blue text color for dark theme
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

.file-upload-input > .q-field__inner > .q-field__control .q-field__control-container {
  height: 100% !important;
}
.file-upload-input > .q-field__inner > .q-field__control .q-field__control-container .q-field__label {
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
  padding: 0  3rem;
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
.expanded-sql{
  border-left: #7A54A2 3px solid;
}


.app-table-container {
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

.editable-input{
    height: 10px !important;
}

.category-select{
    .q-placeholder{
        font-size: 14px !important;
    }
}
.org-select{
    .q-placeholder{
        font-size: 14px !important;
    }
}


</style>