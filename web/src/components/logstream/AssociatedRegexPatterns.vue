<template>
    <div style="width: 60vw; height: calc(100vh - 59px);" :class="store.state.theme === 'dark' ? 'tw:bg-[#1F1F1F] dark-regex-patterns' : 'tw:bg-white light-regex-patterns'">
        <div class="tw:flex tw:items-center no-wrap tw:justify-between tw:px-4 tw:py-2">
        <div class="tw:flex tw:items-center">
            <div class="col-auto">
        </div>
          <div
            class="tw:flex tw:items-center"
            data-test="associated-regex-patterns-title-text"
          >
            <span class="breadcrumb-text tw:cursor-pointer " @click="closeDialog"   >Stream Details &gt; &nbsp;
            </span>
        <span class="associated-field-name">
                 {{ fieldName }}
                </span>
          </div>
        </div>
        <div class="col-auto">
          <q-btn data-test="associated-regex-patterns-close-btn" v-close-popup="true" round flat>
            <q-icon name="cancel" />
          </q-btn>
        </div>
      </div>
      <q-separator />
      
      <!-- here we will have the main section -->
      <div class="tw:flex tw:w-full" >
        <!-- here we will have the left side section -->
        <div class="tw:w-[25%]">
            <div class="tw:flex tw:flex-col tw:px-2 tw:py-2">

                <div>
                    <q-input
                    data-test="associated-regex-patterns-search-input"
                    v-model="filterPattern"
                    data-cy="schema-index-field-search-input"
                    filled
                    borderless
                    dense
                    debounce="1"
                    placeholder="Search"
                    clearable
                >
                  <template #prepend>
                    <q-icon name="search" />
                  </template>
                </q-input>
                </div>
                <div style="height: calc(100vh - 130px); overflow-y: auto;">
                  <div
                    class="pattern-list-wrapper "
                  >
                    <q-expansion-item
                      expand-separator
                      ref="appliedPatternsExpandedRef"
                      :label="`Applied Patterns (${appliedPatterns.length})`"
                      class="q-mt-sm tw:text-[14px] tw:font-[600] associated-regex-patterns-table "
                      data-test="associated-regex-patterns-applied-patterns-expansion-item"
                    >
                      <q-card class="q-pa-none q-ma-none" style="height: 100%;">
                        <q-card-section class="q-pa-none q-ma-none" style="height: 100%;">
                          <q-table
                            style="height: 100%; overflow-y: auto;"
                            data-test="associated-regex-patterns-applied-patterns-table"
                            :rows="appliedPatterns"
                            :columns="appliedFilterColumns"
                            :visible-columns="['pattern_name']"
                            :class="store.state.theme === 'dark' ? 'dark-associated-regex-patterns-table' : 'light-associated-regex-patterns-table'"
                            :rows-per-page-options="[0]"
                            hide-header
                            hide-bottom
                            dense
                            :filter="filterPattern"
                            @filter-method="handleFilterMethod"
                          >
                            <template v-slot:body="props">
                              <q-tr :data-test="`associated-regex-patterns-applied-patterns-table-row-${props.row.pattern_id}`" class="tw:cursor-pointer " :class="[checkCurrentUserClickedPattern(props.row.pattern_name) && store.state.theme === 'dark' ? 'selected-pattern-row' : checkCurrentUserClickedPattern(props.row.pattern_name) ? 'selected-pattern-row' : '']" :props="props" @click="handlePatternClick(props.row)">
                                <q-td :data-test="`associated-regex-patterns-applied-patterns-table-cell-${props.row.pattern_id}`" class="tw:flex tw:justify-between tw:items-center" style="border-bottom: 0px; font-size: 14px; font-weight: 600; padding-top: 20px; padding-bottom: 20px;" :props="props" key="pattern_name">
                                  <span class="regex-pattern-name">
                                    {{ props.row.pattern_name }}
                                  </span>
                                  <span><q-icon name="check" size="xs" color="primary" /></span>
                                </q-td>
                              </q-tr>
                            </template>
                          </q-table>

                        </q-card-section>
                      </q-card>
                    </q-expansion-item>
                  </div>
                  <q-separator class="tw:mt-2" />
                  <div
                    class="pattern-list-wrapper"
                  >
                    <q-expansion-item
                      expand-separator
                      ref="allPatternsExpandedRef"
                      :label="`All Patterns (${resultTotal})`"
                      class="q-mt-sm tw:text-[14px] tw:font-[600] associated-regex-patterns-table "
                      data-test="associated-regex-patterns-all-patterns-expansion-item"
                    >
                      <q-card class="q-pa-none q-ma-none" style="height: 100%;">
                        <q-card-section class="q-pa-none q-ma-none" style="height: 100%;">
                          <q-table
                            style="height: 100%; overflow-y: auto;"
                            data-test="associated-regex-patterns-all-patterns-table"
                            :class="store.state.theme === 'dark' ? 'dark-associated-regex-patterns-table' : 'light-associated-regex-patterns-table'"
                            :rows="allPatterns"
                            :columns="filterColumns"
                            :visible-columns="['pattern_name']"
                            :rows-per-page-options="[0]"
                            hide-header
                            hide-bottom
                            dense
                            :filter="filterPattern"
                            @:filter-method="handleFilterMethod"
                          >
                          <template v-slot:body="props">
                              <q-tr :data-test="`associated-regex-patterns-all-patterns-table-row-${props.row.pattern_id}`" style="padding: 8px 0px !important;"  class="tw:cursor-pointer" :class="[checkCurrentUserClickedPattern(props.row.pattern_name) && store.state.theme === 'dark' ? 'selected-pattern-row' : checkCurrentUserClickedPattern(props.row.pattern_name) ? 'selected-pattern-row' : '']" :props="props" @click="handlePatternClick(props.row)">
                                <q-td :data-test="`associated-regex-patterns-all-patterns-table-cell-${props.row.pattern_id}`" class="tw:flex tw:justify-between tw:items-center " style="border-bottom: 0px;  font-size: 14px; font-weight: 600; padding-top: 20px; padding-bottom: 20px; " :props="props" key="pattern_name">
                                 <span class="regex-pattern-name">{{ props.row.pattern_name }}</span> 
                                  <span v-if="checkIfPatternIsApplied(props.row.pattern_id)">
                                    <q-icon name="check" size="xs" color="primary" />
                                  </span>
                                </q-td>
                              </q-tr>
                            
                            </template>   
                          </q-table>
                        </q-card-section>
                      </q-card>
                    </q-expansion-item>
                  </div>
                </div>

            </div>
        </div>
        <q-separator vertical />
        <!-- here we will have the right side section -->
        <div class="tw:w-[75%] tw:flex tw:flex-col" style="height: calc(100vh - 59px);">
          <div class="tw:flex-1 tw:overflow-y-auto tw:pt-3">
            <div v-if="userClickedPattern" class="tw:flex tw:flex-col tw:gap-3 tw:px-3">
              <!-- Pattern Info Card -->
              <div class="section-card tw:p-3 tw:rounded-lg tw:border" :class="store.state.theme === 'dark' ? 'tw:bg-[#2A2A2A] tw:border-[#3A3A3A]' : 'tw:bg-[#F9FAFB] tw:border-[#E5E7EB]'">
                <div class="tw:flex tw:flex-col tw:gap-2">
                  <!-- pattern name section -->
                  <div class="tw:flex tw:flex-col tw:gap-1">
                    <span class="individual-section-title tw:text-[10px] tw:uppercase tw:tracking-wider tw:opacity-50 tw:font-[600]">
                      Pattern Name
                    </span>
                    <span class="individual-section-value tw:text-[15px] tw:font-[700]" data-test="associated-regex-patterns-pattern-name">
                      {{ userClickedPattern.pattern_name }}
                    </span>
                  </div>

                  <q-separator :class="store.state.theme === 'dark' ? 'tw:bg-[#3A3A3A]' : 'tw:bg-[#E5E7EB]'" />

                  <!-- pattern description section -->
                  <div class="tw:flex tw:flex-col tw:gap-1">
                    <span class="individual-section-title tw:text-[10px] tw:uppercase tw:tracking-wider tw:opacity-50 tw:font-[600]">
                      Description
                    </span>
                    <span class="individual-section-value tw:text-[13px] tw:leading-[1.5]" data-test="associated-regex-patterns-pattern-description">
                      {{ userClickedPattern.description ? userClickedPattern.description : 'No description available' }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Configuration Card -->
              <div class="section-card tw:p-3 tw:rounded-lg tw:border" :class="store.state.theme === 'dark' ? 'tw:bg-[#2A2A2A] tw:border-[#3A3A3A]' : 'tw:bg-[#F9FAFB] tw:border-[#E5E7EB]'">
                <div class="tw:flex tw:gap-4">
                  <!-- when value matches -->
                  <div class="tw:flex tw:flex-col tw:gap-1.5 tw:flex-1">
                    <span class="individual-section-title tw:text-[12px] tw:font-[700]">
                      When value matches
                    </span>
                    <div class="tw:flex tw:flex-col tw:gap-0.5">
                      <div class="tw:flex tw:items-center">
                        <q-radio v-model="policy" val="Redact" data-test="associated-regex-patterns-redact-radio" size="xs" />
                        <div class="tw:flex tw:items-center tw:gap-2 tw:ml-1">
                          <span class="tw:font-[600] tw:text-[12px]">Redact</span>
                          <span class="tw:font-[400] tw:text-[10px] tw:opacity-60">Replace with [REDACTED]</span>
                        </div>
                      </div>
                      <div class="tw:flex tw:items-center">
                        <q-radio v-model="policy" val="DropField" data-test="associated-regex-patterns-drop-field-radio" size="xs" />
                        <div class="tw:flex tw:items-center tw:gap-2 tw:ml-1">
                          <span class="tw:font-[600] tw:text-[12px]">Drop</span>
                          <span class="tw:font-[400] tw:text-[10px] tw:opacity-60">Drop the field completely</span>
                        </div>
                      </div>
                      <div class="tw:flex tw:items-center">
                        <q-radio v-model="policy" val="Hash" data-test="associated-regex-patterns-hash-radio" size="xs" />
                        <div class="tw:flex tw:items-center tw:gap-2 tw:ml-1">
                          <span class="tw:font-[600] tw:text-[12px]">Hash</span>
                          <span class="tw:font-[400] tw:text-[10px] tw:opacity-60">Replace with searchable hash</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <q-separator vertical :class="store.state.theme === 'dark' ? 'tw:bg-[#3A3A3A]' : 'tw:bg-[#E5E7EB]'" />

                  <!-- detect at section -->
                  <div class="tw:flex tw:flex-col tw:gap-1.5 tw:min-w-[120px]">
                    <span class="individual-section-title tw:text-[12px] tw:font-[700]">
                      Detect at
                    </span>
                    <div class="tw:flex tw:flex-col tw:gap-1.5">
                      <q-checkbox size="xs" v-model="apply_at" val="AtIngestion" data-test="associated-regex-patterns-ingestion-checkbox">
                        <span class="individual-section-sub-title tw:font-[600] tw:text-[12px]">Ingestion</span>
                      </q-checkbox>
                      <q-checkbox size="xs" v-model="apply_at" val="AtSearch" data-test="associated-regex-patterns-query-checkbox">
                        <span class="individual-section-sub-title tw:font-[600] tw:text-[12px]">Query</span>
                      </q-checkbox>
                    </div>
                  </div>
                </div>
              </div>

              <q-separator :class="store.state.theme === 'dark' ? 'tw:bg-[#444444]' : 'tw:bg-[#D1D5DB]'" />

              <!-- Test Pattern Card -->
              <div class="section-card tw:p-3 tw:rounded-lg tw:border" :class="store.state.theme === 'dark' ? 'tw:bg-[#2A2A2A] tw:border-[#3A3A3A]' : 'tw:bg-[#F9FAFB] tw:border-[#E5E7EB]'">
                <div class="tw:flex tw:flex-col tw:gap-2.5">
                  <div class="tw:flex tw:items-center tw:justify-between">
                    <span class="individual-section-title-main tw:text-[13px] tw:font-[700]">
                      Test Pattern
                    </span>
                    <q-btn
                      :disable="testString.length === 0 || testLoading"
                      class="o2-primary-button tw:h-[28px]"
                      flat
                      dense
                      no-caps
                      @click="testStringOutput">
                      <span class="tw:text-[12px]">Test Input</span>
                    </q-btn>
                  </div>

                  <div class="tw:flex tw:flex-col tw:gap-1">
                    <span class="individual-section-sub-title2 tw:text-[10px] tw:uppercase tw:tracking-wider tw:opacity-50 tw:font-[600]">
                      Regex Pattern
                    </span>
                    <div class="tw:p-2 tw:rounded tw:font-mono tw:text-[11px] tw:break-all" :class="store.state.theme === 'dark' ? 'tw:bg-[#1A1A1A]' : 'tw:bg-[#FFFFFF]'">
                      <span class="regex-pattern-text" data-test="associated-regex-patterns-regex-pattern">
                        {{ userClickedPattern.pattern }}
                      </span>
                    </div>
                  </div>

                  <q-separator :class="store.state.theme === 'dark' ? 'tw:bg-[#3A3A3A]' : 'tw:bg-[#E5E7EB]'" />

                  <div class="tw:flex tw:flex-col tw:gap-2">
                    <div class="regex-pattern-test-string-container">
                      <FullViewContainer
                        name="query"
                        v-model:is-expanded="expandState.regexTestString"
                        label="Input string"
                        class="tw:py-md tw:h-[24px]"
                        :labelClass="store.state.theme === 'dark' ? 'dark-test-string-container-label' : 'light-test-string-container-label'"
                      />
                      <div v-if="expandState.regexTestString" class="regex-pattern-input tw:mt-2">
                        <q-input
                          data-test="add-regex-test-string-input"
                          v-model="testString"
                          color="input-border"
                          bg-color="input-bg"
                          class="regex-test-string-input"
                          :class="store.state.theme === 'dark' ? 'dark-mode-regex-test-string-input' : 'light-mode-regex-test-string-input'"
                          stack-label
                          outlined
                          filled
                          dense
                          tabindex="0"
                          style="width: 100%; resize: none;"
                          type="textarea"
                          placeholder="Eg. 1234567890"
                          rows="5"
                        />
                      </div>
                    </div>

                    <div class="regex-pattern-test-string-container">
                      <FullViewContainer
                        name="output"
                        v-model:is-expanded="expandState.outputString"
                        label="Output"
                        class="tw:py-md tw:h-[24px]"
                        :labelClass="store.state.theme === 'dark' ? 'dark-test-string-container-label' : 'light-test-string-container-label'"
                      />
                      <div v-if="expandState.outputString" class="regex-pattern-input tw:mt-2">
                        <q-input
                          v-if="outputString.length > 0"
                          data-test="add-regex-test-string-input"
                          v-model="outputString"
                          color="input-border"
                          bg-color="input-bg"
                          class="regex-test-string-input"
                          :class="store.state.theme === 'dark' ? 'dark-mode-regex-test-string-input' : 'light-mode-regex-test-string-input'"
                          stack-label
                          outlined
                          filled
                          dense
                          tabindex="0"
                          style="width: 100%; resize: none;"
                          type="textarea"
                          placeholder="Output String"
                          rows="5"
                        />
                        <div v-else class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-[111px]"
                          :class="store.state.theme === 'dark' ? 'dark-mode-regex-no-output' : 'light-mode-regex-no-output'">
                          <div v-if="!testLoading && outputString.length === 0">
                            <q-icon :name="outlinedLightbulb" size="24px" :class="store.state.theme === 'dark' ? 'tw:text-[#ffffff]' : 'tw:text-[#A8A8A8]'" />
                            <span class="tw:text-[12px] tw:font-[400] tw:text-center" :class="store.state.theme === 'dark' ? 'tw:text-[#ffffff]' : 'tw:text-[#4B5563]'">
                              Please click Test Input to see the results
                            </span>
                          </div>
                          <div v-else-if="testLoading">
                            <span class="tw:flex tw:items-center tw:justify-center tw:h-[111px]">
                              <q-spinner-hourglass color="primary" size="24px" />
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>


              <!-- remove or add pattern button  -->
               <div class="tw:mb-4">
                <q-btn @click="handleAddOrRemovePattern" borderless no-caps class="q-mr-md o2-secondary-button tw:h-[36px] no-border">
                  <q-icon class="tw:mr-1" :name="checkIfPatternIsApplied(userClickedPattern.pattern_id) ? 'delete' : 'add'"></q-icon>
                  <span>
                    {{ checkIfPatternIsApplied(userClickedPattern.pattern_id) ? 'Remove Pattern' : 'Add Pattern' }}
                  </span> 
                </q-btn>
               </div>

               <!-- cancel and update settings button -->
            </div>
            <div class="tw:h-full" v-if="!userClickedPattern">
              <div
                class="full-width column flex-center q-gutter-sm tw:h-full"
                style="font-size: 1.5rem; margin: auto auto"
                :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'"
              >
                <q-img
                  :src="getImageURL('images/regex_pattern/no_applied_pattern.svg')"
                  style="width: 125px;"
                />
                <span class="no-pattern-applied-title" data-test="associated-regex-patterns-no-pattern-applied-title">No Patterns Applied Yet</span>
                  <span class="no-pattern-applied-subtitle" data-test="associated-regex-patterns-no-pattern-applied-subtitle">Browse the pattern library to begin </span> 
                  <span class="no-pattern-applied-subtitle" data-test="associated-regex-patterns-no-pattern-applied-subtitle">
                    applying regular expressions to your fields.
                  </span>
              </div>
            </div>
          </div>
          <q-separator />
          <div v-if="userClickedPattern" :class="store.state.theme === 'dark' ? 'dark-regex-patterns-footer' : 'light-regex-patterns-footer'" class="tw:flex tw:justify-end tw:px-4 tw:py-2">
            <q-btn
              v-close-popup="true"
              label="Cancel"
              class="q-mr-md o2-secondary-button tw:h-[36px] no-border"
              padding="sm md"
              no-caps
              data-test="associated-regex-patterns-cancel-btn"
            />
            <q-btn
              data-test="associated-regex-patterns-update-btn"
              label="Update Changes"
              class="q-pa-none o2-primary-button tw:h-[34px] element-box-shadow"
              padding="sm xl"
              type="submit"
              no-caps
              dense
              flat
              @click="updateRegexPattern"
              :disabled="!isFormDirty"
            />
          </div>
        </div>
      </div>
    </div>
    <ConfirmDialog
      title="Remove Pattern"
      message="Are you sure you want to remove this pattern from the field?"
      @update:ok="handleAddOrRemovePattern"
      @update:cancel="handleCancelRemovePattern"
      v-model="showWarningDialogToRemovePattern"
    />

</template>

<script lang="ts">
import { defineComponent, nextTick, onMounted, onBeforeUnmount, PropType, ref, watch } from 'vue';
import { useStore } from 'vuex';
import regexPatternsService from '@/services/regex_pattern';
import { convertUnixToQuasarFormat, getImageURL } from '@/utils/zincutils';
import { debounce, useQuasar } from 'quasar';
import store from '@/test/unit/helpers/store';
import { useI18n } from 'vue-i18n';
import FullViewContainer from '../functions/FullViewContainer.vue';
import { outlinedLightbulb } from "@quasar/extras/material-icons-outlined";
import ConfirmDialog from '../ConfirmDialog.vue';

export interface PatternAssociation {
    field: string;
    pattern_name: string;
    pattern_id: string;
    policy: string;
    apply_at: string;
}
export default defineComponent({
    name: "AssociatedRegexPatterns",
    components: {
        FullViewContainer,
        ConfirmDialog
    },
    props: {
        data: {
            type: Array as PropType<PatternAssociation[]>,
            required: true
        },
        fieldName: {
            type: String,
            required: true
        }
    },
    emits: ["closeDialog", "addPattern", "removePattern", "updateSettings", "updateAppliedPattern"],
    setup(props, { emit }){
        const store = useStore();
        const filterPattern = ref("");
        const { t } = useI18n();
          const appliedFilterColumns = ref<any[]>([
            { name: "pattern_name", label: "Name", field: "pattern_name", align: "left" }
          ]);
          const filterColumns = ref<any[]>([
            { name: "pattern_name", label: "Name", field: "pattern_name", align: "left" }
          ]);
        const allPatterns = ref([]);
        const selectedPatterns = ref<any[]>([]);
        const listLoading = ref(false);
        const resultTotal = ref(0);
        const appliedPatterns = ref(props.data ? props.data : []);
        const allPatternsExpanded = ref(true);
        const appliedPatternsExpanded = ref(true);
        const appliedPatternsMap = ref(new Map());
        // Add a flag to track if patterns were added or removed
        const hasPatternChanges = ref(false);
        // Add a debounced emit function
        const debouncedEmit = debounce((pattern: PatternAssociation, fieldName: string, patternId: string, attribute: string) => {
          emit("updateAppliedPattern", pattern, fieldName, patternId, attribute);
        }, 300);
        const $q = useQuasar();
        const userClickedPattern = ref<any>(null);
        const isPatternValid = ref(false);
        const testString = ref("");
        const policy = ref("Redact");
        const apply_at = ref<any>([]);
        const appliedPatternsExpandedRef = ref<any>(null);
        const allPatternsExpandedRef = ref<any>(null);
        const isFormDirty = ref(false);
        const queryEditorRef = ref<any>(null);
        const testLoading = ref(false);
        const showWarningDialogToRemovePattern = ref(false);
        const outputString = ref("");
        const expandState = ref({
          regexTestString: true,
          outputString: false
        });

        const testStringOutput = async () => {
          try{
            expandState.value.outputString = true;
            outputString.value = "";
            testLoading.value = true;
            const response = await regexPatternsService.test(store.state.selectedOrganization.identifier, userClickedPattern.value.pattern, [testString.value], policy.value);
            outputString.value = response.data.results[0];
          } catch (error) {
            $q.notify({
              color: "negative",
              message: error.response?.data?.message || "Failed to test string",
              timeout: 4000,
            });
          }
          finally{
            testLoading.value = false;
          }
        }

        const closeDialog = () => {
            hasPatternChanges.value = false;
            isFormDirty.value = false;
            emit("closeDialog");
        };

        onMounted( async () => {
          //if there are no regex patterns then we fetch them from the server
          //otherwise we use the cached regex patterns from the store
          if(store.state.organizationData.regexPatterns.length == 0){
            await getRegexPatterns();
          }
          else{
            allPatterns.value = store.state.organizationData.regexPatterns.map((pattern: any) => ({
              ...pattern,
              pattern_name: pattern.name,
              pattern_id: pattern.id,
              apply_at: "",
              policy: "",
              field: props.fieldName
            }));
            resultTotal.value = store.state.organizationData.regexPatterns.length;
          }
          // Initialize the applied patterns map
          appliedPatternsMap.value = new Map(props.data.map((p: any) => [p.pattern_id, p]));
          //this is used to toggle the applied patterns and all patterns expansion items
          //so that we can show the applied patterns and all patterns in the applied patterns and all patterns list
          await nextTick();
          appliedPatternsExpandedRef.value.toggle();
          allPatternsExpandedRef.value.toggle();
          //this is done because we dont want to show the empty page at first when user lands at this page
          //so we select the first pattern from the applied patterns list if there are any applied patterns
          //other wise we show no pattern applied yet page
          if(props.data.length > 0){
            userClickedPattern.value = props.data[0];
          }
        })

        // Add cleanup
        onBeforeUnmount(() => {
            // Clear references
            userClickedPattern.value = null;
            appliedPatternsExpandedRef.value = null;
            allPatternsExpandedRef.value = null;
        });
        //reset the values when user clicks on a pattern from the list
        //because we need to reset the values when user clicks on a pattern from the list
        //here we are doing one optimization to check if the pattern is applied or not 
        //if not applied then we will not show the apply_at and policy values
        //if applied then we will show the apply_at and policy values that we will find in the applied patterns map that we have created in the onMounted function
        watch(()=> userClickedPattern.value, (newVal) => {
          if (!newVal) return;
          
          // Check if this pattern has applied settings in our map
          const appliedPattern = appliedPatternsMap.value.get(newVal.pattern_id);
          
          if (appliedPattern) {
            // Use the applied pattern's settings
            let applied_at_value = appliedPattern.apply_at;
            if(applied_at_value == 'Both'){
              apply_at.value = ['AtIngestion', 'AtSearch'];
            } else {
              apply_at.value = applied_at_value ? [applied_at_value] : [];
            }
            policy.value = appliedPattern.policy || "Redact";
          } else {
            // Reset to defaults if pattern is not applied
            apply_at.value = [];
            policy.value = "Redact";
          }
          resetInputValues();
        })
        //this runs when users clicks on add / remove pattern button 
        //to update the applied patterns list
        watch(()=> props.data.length, (newVal) => {
          isFormDirty.value = true;
          appliedPatterns.value = [...props.data];
          // Update our map when applied patterns change
          //because we need to check further if the pattern is applied or not
          appliedPatternsMap.value = new Map(props.data.map((p: any) => [p.pattern_id, p]));
        })
        watch(()=> policy.value, (newVal) => {
          if(checkIfPatternIsAppliedAndUpdate(userClickedPattern.value.pattern_id)){
            let updatedPattern = {
              ...userClickedPattern.value,
              policy: newVal,
            }
            // Use debounced emit for policy changes
            debouncedEmit(updatedPattern, props.fieldName, userClickedPattern.value.pattern_id, "policy");
          }
        })
        watch(()=> apply_at.value, (newVal) => {
          if(checkIfPatternIsAppliedAndUpdate(userClickedPattern.value.pattern_id)){
            //here we need to handle if user deselects the apply_at value then we need to show a message to the user 
            //that they are willing to remove the pattern from the field if yes we can do that otherwise we need to show the user 
            //the previous value of apply_at only
            if(newVal.length == 0){
              showWarningToRemovePattern();
            }
            let apply_at_value = "";
            if(newVal.length == 2){
              apply_at_value = 'Both';
            }
            else{
              apply_at_value = newVal[0];
            }
            let updatedPattern = {
              ...userClickedPattern.value,
              apply_at: apply_at_value
            }
            // Use debounced emit for apply_at changes
            debouncedEmit(updatedPattern, props.fieldName, userClickedPattern.value.pattern_id, "apply_at");
          }
        })


        const getRegexPatterns = async () => {
            listLoading.value = true;
            try{
              const response = await regexPatternsService.list(store.state.selectedOrganization.identifier);
              let counter = 1;
              allPatterns.value = response.data.patterns.map((pattern: any) => ({
                ...pattern,
                "#": counter <= 9 ? `0${counter++}` : counter++,
                created_at: convertUnixToQuasarFormat(pattern.created_at),
                updated_at: convertUnixToQuasarFormat(pattern.updated_at),
                pattern_name: pattern.name,
                pattern_id: pattern.id,
                field: props.fieldName
              }));
              store.dispatch("setRegexPatterns", allPatterns.value);
              resultTotal.value = allPatterns.value.length;
            } catch (error) {
              $q.notify({
                message: error?.response?.data?.message || error?.data?.message || "Error fetching regex patterns",
                color: "negative",
                icon: "error",
              });
            }
            finally{
              listLoading.value = false;
            }
          }
        const checkIfPatternIsApplied = (patternId: string) => {
          // Use Map for O(1) lookup instead of array search
          return appliedPatternsMap.value.has(patternId);
        }
        const handlePatternClick = (pattern: any) => {
          userClickedPattern.value = pattern;
        }
        const checkCurrentUserClickedPattern = (patternName: string) => {
          return userClickedPattern.value?.pattern_name === patternName;
        }

        //used filter method to filter the patterns based on the name
        const handleFilterMethod = (rows: any[], terms: string) => {
          const lowerTerm = terms.toLowerCase();
          const filtered = rows.filter(row =>
            row?.name?.toLowerCase().includes(lowerTerm)
          );
          resultTotal.value = filtered.length;
          return filtered;
        };


        const updateRegexPattern = () => {
          emit("updateSettings");
          isFormDirty.value = false;
          // Reset the pattern changes flag after update
          hasPatternChanges.value = false;
        }

        //this is used to add or remove a pattern from the field
        //if the pattern is already applied then we remove it
        //otherwise we add it
        const handleAddOrRemovePattern = () => {
          if(checkIfPatternIsApplied(userClickedPattern.value.pattern_id)){
            //remove pattern
            emit("removePattern", userClickedPattern.value.pattern_id, props.fieldName);
            appliedPatterns.value = appliedPatterns.value.filter((pattern: any) => pattern.pattern_id !== userClickedPattern.value.pattern_id);
            appliedPatternsMap.value.delete(userClickedPattern.value.pattern_id);
            // Set flag when pattern is removed
            hasPatternChanges.value = true;
            isFormDirty.value = true;
          }
          else{
            if(apply_at.value.length == 0){
              $q.notify({
                message: "Please select detect at option",
                color: "negative",
                icon: "error",
              });
              return;
            }
            let apply_at_value = "";
            //add pattern
            if(apply_at.value.length == 2){
              apply_at_value = 'Both';
            }
            else{
              apply_at_value = apply_at.value[0];
            }
            const pattern = {
              field: props.fieldName,
              pattern_name: userClickedPattern.value.pattern_name,
              pattern_id: userClickedPattern.value.pattern_id,
              policy: policy.value,
              apply_at: apply_at_value,
              pattern: userClickedPattern.value.pattern,
              description: userClickedPattern.value.description
            }
            emit("addPattern", pattern);
            // Let the watcher handle updating appliedPatterns
            appliedPatternsMap.value.set(pattern.pattern_id, pattern);
            // Set flag when pattern is added
            hasPatternChanges.value = true;
            isFormDirty.value = true;
          }
          //this is for safety to close the warning dialog whenever user clicks on add or remove pattern button
          showWarningDialogToRemovePattern.value = false;

        }
        //why this check because user might update the policy or apply_at value of already applied pattern 
        //so we need to check if the policy or apply_at value is changed and if it is then we need to update the isFormDirty value
        //so that the user can see the update changes button
        //after this we need to add the logic to add this to add array
        const checkIfPatternIsAppliedAndUpdate = (patternId: string) => {
          // Use Map for O(1) lookup instead of array search
          const applied_pattern = appliedPatternsMap.value.get(patternId);
          let apply_at_value = "";
          if(apply_at.value.length == 2){
            apply_at_value = 'Both';
          }
          else{
            apply_at_value = apply_at.value[0] || "";
          }
          if(applied_pattern){
            // Only update isFormDirty if there are no pattern add/remove changes
            if (!hasPatternChanges.value) {
              isFormDirty.value = applied_pattern.policy !== policy.value || applied_pattern.apply_at !== apply_at_value;
            }
            return true;
          }
          return false;
        }

        // Keep appliedPatternsMap in sync with appliedPatterns
        watch(() => props.data, (newVal) => {
          appliedPatternsMap.value = new Map(newVal.map(p => [p.pattern_id, p]));
        }, { immediate: true });

        const resetInputValues = () => {
          testString.value = "";
          outputString.value = "";
          expandState.value.outputString = false;
          expandState.value.regexTestString = true;
        }

        const showWarningToRemovePattern = () => {
          //here we need to show the user the previous value of apply_at
          //if user clicks on no then we need to show the user the previous value of apply_at
          //otherwise we need to remove the pattern from the field
          showWarningDialogToRemovePattern.value = true;
        }

        const handleCancelRemovePattern = async () => {
          showWarningDialogToRemovePattern.value = false;
          //we need to get the previous value of apply_at values 
          //and set it to the apply_at value
          //we need to get the previous value of apply_at values 
          //so we are transforming the apply_at value to the previous value of apply_at values
          apply_at.value = transformApplyAtValue(userClickedPattern.value?.apply_at);
        };

        const transformApplyAtValue = (applyAtValue: string) => {
          let applyAtValues = [];
          if(applyAtValue == 'Both'){
            applyAtValues = ['AtIngestion', 'AtSearch'];
          }
          else{
            applyAtValues = [applyAtValue];
          }
          return applyAtValues;
        }


        return {
            store,
            closeDialog,
            filterPattern,
            filterColumns,
            selectedPatterns,
            allPatterns,
            allPatternsExpanded,
            listLoading,
            resultTotal,
            getRegexPatterns,
            appliedPatterns,
            appliedPatternsExpanded,
            appliedFilterColumns,
            checkIfPatternIsApplied,
            handlePatternClick,
            userClickedPattern,
            checkCurrentUserClickedPattern,
            testString,
            policy,
            apply_at,
            isPatternValid,
            appliedPatternsExpandedRef,
            allPatternsExpandedRef,
            handleFilterMethod,
            updateRegexPattern,
            handleAddOrRemovePattern,
            isFormDirty,
            getImageURL,
            t,
            queryEditorRef,
            testLoading,
            testStringOutput,
            outputString,
            expandState,
            outlinedLightbulb,
            resetInputValues,
            // Additional exposed methods for testing
            checkIfPatternIsAppliedAndUpdate,
            appliedPatternsMap,
            hasPatternChanges,
            debouncedEmit,
            showWarningDialogToRemovePattern,
            showWarningToRemovePattern,
            handleCancelRemovePattern,
            transformApplyAtValue,
        }
    }
})

</script>

<style lang="scss">
.breadcrumb-text{
    font-size: 18px;
    font-weight: 400;
    line-height: 24px;
}
.associated-field-name{
    font-size: 18px;
    font-weight: 400;
    line-height: 24px;
}
.light-regex-patterns{
    .breadcrumb-text{
        color: #5960b2;        
    }
    .associated-field-name{
        color: #000;
    }
}
.dark-regex-patterns{
  .breadcrumb-text{
    color: #5960b2;
  }
  .associated-field-name{
    color: #fff;
  }
}

    .individual-section-title{
      font-size: 14px;
      font-weight: 600;
    }
    .individual-section-title-main{
      font-size: 16px;
      font-weight: 600;
      line-height: 24px;
    }
    .individual-section-sub-title{
      font-size: 14px;
      font-weight: 600;
      line-height: 24px;
    }
    .individual-section-sub-title2{
      font-size: 14px;
      font-weight: 600;
      line-height: 24px;
    }
    .individual-section-sub-information{
      font-size: 14px;
      font-weight: 400;
      line-height: 24px;
    }
    .regex-pattern-text{
      font-size: 12px;
      font-weight: 400;
      line-height: 24px;
      word-wrap: break-word;
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }


    .light-regex-patterns{
      .individual-section-title{
        color: #000000;
      }
      .individual-section-sub-title{
        color: #000000;
      }
      .individual-section-sub-information{
        color: #000000;
      }
      .individual-section-value{
        color: #000000;
      }
      .regex-pattern-text{
        color: #5A5A5A;
      }
    }
    .dark-regex-patterns{
      .individual-section-value{
        color: #ffffff;
      }
    }
    .add-remove-pattern-button-light{
      color:#5960B2;
      border: 1px solid #5960B2 ;
      width: fit-content;
    }
    .add-remove-pattern-button-dark{
      color:#5960B2;
      border: 1px solid #5960B2 ;
      width: fit-content;
    }

  .regex-test-string-input > div > div > div > textarea{
    resize: none !important;
    }
    .is-pattern-valid > div > div  { 
        .q-field__native {
            color: green !important;
        }
    }

    .selected-pattern-row {
      color: var(--o2-tab-text-color);
      background-color: var(--o2-tab-bg);
  }
.dark-associated-regex-patterns-table{
  background-color: #1F1F1F !important;
}
.associated-regex-patterns-table{
  .q-table__card{
    border-radius: 0px !important;
  }
}
.dark-regex-patterns-footer{
  background-color: #1F1F1F !important;
}
.light-regex-patterns-footer{
  background-color: #ffffff !important;
}
.regex-pattern-name {
  white-space: nowrap;
  overflow: hidden;
  max-width: 10vw;
  text-overflow: ellipsis;
  text-transform: none !important;
  }
  .no-pattern-applied-title{
    font-size: 16px;
    font-weight: 600;
    line-height: 32px;
  }
  .no-pattern-applied-subtitle{
    font-size: 14px;
    font-weight: 400;
    line-height: 12px;
  }
  .regex-pattern-associated-test-string-editor{
    .lines-content{
      padding-left: 12px !important;
    }
  }
  .dark-mode-regex-test-string-input .q-field__control  { 
        background-color:#181A1B !important;
        border-top: 1px solid #666666 !important;
        border-left: 1px solid #666666 !important;
        border-right: 1px solid #666666 !important;
        border-bottom: 1px solid #666666 !important;
    }
    .light-mode-regex-test-string-input .q-field__control { 
    background-color:#ffffff !important;
    border-top: 1px solid #E6E6E6 !important;
    border-left: 1px solid #E6E6E6 !important;
    border-right: 1px solid #E6E6E6 !important;
    border-bottom: 1px solid #E6E6E6 !important;
    
    }
    .light-mode-regex-associated-test-string-input .monaco-editor-background{
      background-color: #ffffff !important;
    }
    .dark-mode-regex-associated-test-string-input .monaco-editor-background{
      background-color: #1f1f1f !important;
    }
    .dark-mode-regex-no-output{
        background-color:#181A1B !important;
        border-left: 2px solid #212121 !important;
        border-right: 2px solid #212121 !important;
        border-bottom: 2px solid #212121 !important;
    }
    .light-mode-regex-no-output{
        background-color:#ffffff !important;
        border-left: 1px solid #E6E6E6 !important;
        border-right: 1px solid #E6E6E6 !important;
        border-bottom: 1px solid #E6E6E6 !important;
    }

</style>