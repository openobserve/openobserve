<template>
  <div
    style="width: 60vw; height: calc(100vh - 59px)"
    :class="
      store.state.theme === 'dark'
        ? 'tw:bg-[#1F1F1F] dark-regex-patterns'
        : 'tw:bg-white light-regex-patterns'
    "
  >
    <div
      class="tw:flex tw:items-center tw:flex-nowrap tw:justify-between tw:px-4 tw:py-2"
    >
      <div class="tw:flex tw:items-center">
        <div class="col-auto"></div>
        <div
          class="tw:flex tw:items-center"
          data-test="associated-regex-patterns-title-text"
        >
          <span class="breadcrumb-text tw:cursor-pointer" @click="closeDialog"
            >Stream Details &gt; &nbsp;
          </span>
          <span class="associated-field-name">
            {{ fieldName }}
          </span>
        </div>
      </div>
      <div class="col-auto">
        <OButton
          data-test="associated-regex-patterns-close-btn"
          @click="$emit('closeDialog')"
          variant="ghost"
          size="icon-sm"
          icon-left="close"
        />
      </div>
    </div>
    <OSeparator />

    <!-- here we will have the main section -->
    <div class="tw:flex tw:w-full">
      <!-- here we will have the left side section -->
      <div class="tw:w-[25%]">
        <div class="tw:flex tw:flex-col tw:px-2 tw:py-2">
          <div>
            <OSearchInput
              data-test="associated-regex-patterns-search-input"
              v-model="filterPattern"
              data-cy="schema-index-field-search-input"
              placeholder="Search"
              clearable
            />
          </div>
          <div style="height: calc(100vh - 130px); overflow-y: auto">
            <div class="pattern-list-wrapper">
              <OCollapsible
                v-model="appliedPatternsExpandedRef"
                :label="`Applied Patterns (${appliedPatterns.length})`"
                class="tw:mt-2 tw:text-[14px] tw:font-[600]"
                data-test="associated-regex-patterns-applied-patterns-expansion-item"
              >
                <div
                  v-if="filteredAppliedPatterns.length === 0"
                  class="tw:py-3 tw:px-2 tw:text-[12px] tw:opacity-50"
                  data-test="associated-regex-patterns-applied-patterns-table"
                >
                  No data available
                </div>
                <ul v-else class="tw:list-none tw:p-0 tw:m-0" data-test="associated-regex-patterns-applied-patterns-table">
                  <li
                    v-for="row in filteredAppliedPatterns"
                    :key="row.pattern_id"
                    :data-test="`associated-regex-patterns-applied-patterns-table-row-${row.pattern_id}`"
                    class="tw:cursor-pointer tw:flex tw:justify-between tw:items-center tw:px-2 tw:py-2.5 tw:border-b tw:text-[13px] tw:font-[600]"
                    :class="checkCurrentUserClickedPattern(row.pattern_name) ? 'selected-pattern-row' : ''"
                    @click="handlePatternClick(row)"
                  >
                    <span class="regex-pattern-name">{{ row.pattern_name }}</span>
                    <OIcon name="check" size="xs" />
                  </li>
                </ul>
              </OCollapsible>
            </div>
            <OSeparator class="tw:mt-2" />
            <div class="pattern-list-wrapper">
              <OCollapsible
                v-model="allPatternsExpandedRef"
                :label="`All Patterns (${resultTotal})`"
                class="tw:mt-2 tw:text-[14px] tw:font-[600]"
                data-test="associated-regex-patterns-all-patterns-expansion-item"
              >
                <ul class="tw:list-none tw:p-0 tw:m-0" data-test="associated-regex-patterns-all-patterns-table">
                  <li
                    v-for="row in filteredAllPatterns"
                    :key="row.pattern_id"
                    :data-test="`associated-regex-patterns-all-patterns-table-row-${row.pattern_id}`"
                    class="tw:cursor-pointer tw:flex tw:justify-between tw:items-center tw:px-2 tw:py-2.5 tw:border-b tw:text-[13px] tw:font-[600]"
                    :class="checkCurrentUserClickedPattern(row.pattern_name) ? 'selected-pattern-row' : ''"
                    @click="handlePatternClick(row)"
                  >
                    <span class="regex-pattern-name">{{ row.pattern_name }}</span>
                    <OIcon v-if="checkIfPatternIsApplied(row.pattern_id)" name="check" size="xs" />
                  </li>
                </ul>
              </OCollapsible>
            </div>
          </div>
        </div>
      </div>
      <OSeparator vertical />
      <!-- here we will have the right side section -->
      <div class="tw:w-[75%] tw:flex tw:flex-col" style="height: calc(100vh - 59px)">
        <div class="tw:flex-1 tw:overflow-y-auto tw:pt-3">
          <div
            v-if="!userClickedPattern"
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:gap-4 tw:px-6 tw:py-12"
          >
            <img
              data-test="associated-regex-patterns-no-pattern-image"
              :src="getImageURL('images/regex_pattern/no_applied_pattern.svg')"
              style="width: 125px"
              alt=""
            />
            <span
              class="no-pattern-applied-title"
              data-test="associated-regex-patterns-no-pattern-applied-title"
              >No Patterns Applied Yet</span
            >
            <span
              class="no-pattern-applied-subtitle tw:text-center"
              data-test="associated-regex-patterns-no-pattern-applied-subtitle"
              >Browse the pattern library to begin applying regular expressions
              to your fields.</span
            >
          </div>
          <div
            v-else
            class="tw:flex tw:flex-col tw:gap-3 tw:px-3 tw:pb-4"
          >
            <!-- Pattern Info Card -->
            <div
              class="section-card tw:p-3 tw:rounded-lg tw:border"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:bg-[#2A2A2A] tw:border-[#3A3A3A]'
                  : 'tw:bg-[#F9FAFB] tw:border-[#E5E7EB]'
              "
            >
              <div class="tw:flex tw:flex-col tw:gap-2">
                <div class="tw:flex tw:flex-col tw:gap-1">
                  <span class="individual-section-title tw:text-[12px] tw:font-[500]">
                    Pattern Name
                  </span>
                  <span
                    class="individual-section-value tw:text-[15px] tw:font-[700]"
                    data-test="associated-regex-patterns-pattern-name"
                  >
                    {{ userClickedPattern.pattern_name }}
                  </span>
                </div>

                <OSeparator />

                <div class="tw:flex tw:flex-col tw:gap-1">
                  <span class="individual-section-title tw:text-[12px] tw:font-[500]">
                    Description
                  </span>
                  <span
                    class="individual-section-value tw:text-[15px] tw:font-[700]"
                    data-test="associated-regex-patterns-pattern-description"
                  >
                    {{
                      userClickedPattern.description
                        ? userClickedPattern.description
                        : "No description available"
                    }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Configuration Card -->
            <div
              class="section-card tw:p-3 tw:rounded-lg tw:border"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:bg-[#2A2A2A] tw:border-[#3A3A3A]'
                  : 'tw:bg-[#F9FAFB] tw:border-[#E5E7EB]'
              "
            >
              <div class="tw:flex tw:gap-4">
                <!-- when value matches -->
                <div class="tw:flex tw:flex-col tw:gap-1.5 tw:flex-1">
                  <span class="individual-section-title tw:text-[12px] tw:font-[500]">
                    When value matches
                  </span>
                  <ORadioGroup v-model="policy">
                    <div class="tw:flex tw:flex-col tw:gap-1">
                      <div class="tw:flex tw:items-center tw:gap-2">
                        <ORadio
                          value="Redact"
                          data-test="associated-regex-patterns-redact-radio"
                          size="sm"
                        />
                        <span class="tw:font-[600] tw:text-[13px]">Redact</span>
                        <span class="tw:font-[400] tw:text-[12px] tw:opacity-60">Replace with [REDACTED]</span>
                      </div>
                      <div class="tw:flex tw:items-center tw:gap-2">
                        <ORadio
                          value="DropField"
                          data-test="associated-regex-patterns-drop-field-radio"
                          size="sm"
                        />
                        <span class="tw:font-[600] tw:text-[13px]">Drop</span>
                        <span class="tw:font-[400] tw:text-[12px] tw:opacity-60">Drop the field completely</span>
                      </div>
                      <div class="tw:flex tw:items-center tw:gap-2">
                        <ORadio
                          value="Hash"
                          data-test="associated-regex-patterns-hash-radio"
                          size="sm"
                        />
                        <span class="tw:font-[600] tw:text-[13px]">Hash</span>
                        <span class="tw:font-[400] tw:text-[12px] tw:opacity-60">Replace with searchable hash</span>
                      </div>
                    </div>
                  </ORadioGroup>
                </div>

                <OSeparator vertical />

                <!-- detect at section -->
                <div class="tw:flex tw:flex-col tw:gap-1.5 tw:min-w-[120px]">
                  <span class="individual-section-title tw:text-[12px] tw:font-[500]">
                    Detect at
                  </span>
                  <div class="tw:flex tw:flex-col tw:gap-1.5">
                    <OCheckbox
                      size="sm"
                      v-model="apply_at"
                      val="AtIngestion"
                      label="Ingestion"
                      data-test="associated-regex-patterns-ingestion-checkbox"
                    />
                    <OCheckbox
                      size="sm"
                      v-model="apply_at"
                      val="AtSearch"
                      label="Query"
                      data-test="associated-regex-patterns-query-checkbox"
                    />
                  </div>
                </div>
              </div>
            </div>

            <OSeparator class="tw:bg-separator-strong" />

            <!-- Test Pattern Card -->
            <div
              class="section-card tw:p-3 tw:rounded-lg tw:border"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:bg-[#2A2A2A] tw:border-[#3A3A3A]'
                  : 'tw:bg-[#F9FAFB] tw:border-[#E5E7EB]'
              "
            >
              <div class="tw:flex tw:flex-col tw:gap-2.5">
                <div class="tw:flex tw:items-center tw:justify-between">
                  <span
                    class="individual-section-title-main tw:text-[13px] tw:font-[700]"
                  >
                    Test Pattern
                  </span>
                  <OButton
                    :disabled="testString.length === 0 || testLoading"
                    variant="primary"
                    size="sm-action"
                    @click="testStringOutput"
                  >
                    <span class="tw:text-[12px]">Test Input</span>
                  </OButton>
                </div>

                <div class="tw:flex tw:flex-col tw:gap-1">
                  <span
                    class="individual-section-sub-title2 tw:text-[12px] tw:font-[500]"
                  >
                    Regex Pattern
                  </span>
                  <div
                    class="tw:p-2 tw:rounded tw:font-mono tw:text-[11px] tw:break-all"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:bg-[#1A1A1A]'
                        : 'tw:bg-[#FFFFFF]'
                    "
                  >
                    <span
                      class="regex-pattern-text"
                      data-test="associated-regex-patterns-regex-pattern"
                    >
                      {{ userClickedPattern.pattern }}
                    </span>
                  </div>
                </div>

                <OSeparator />

                <div class="tw:flex tw:flex-col tw:gap-2">
                  <div class="regex-pattern-test-string-container">
                    <FullViewContainer
                      name="query"
                      v-model:is-expanded="expandState.regexTestString"
                      label="Input string"
                      class="tw:py-md tw:h-[24px]"
                      :labelClass="
                        store.state.theme === 'dark'
                          ? 'dark-test-string-container-label'
                          : 'light-test-string-container-label'
                      "
                    />
                    <div
                      v-if="expandState.regexTestString"
                      class="regex-pattern-input tw:mt-2"
                    >
                      <OInput
                        data-test="add-regex-test-string-input"
                        v-model="testString"
                        class="regex-test-string-input"
                        :class="
                          store.state.theme === 'dark'
                            ? 'dark-mode-regex-test-string-input'
                            : 'light-mode-regex-test-string-input'
                        "
                        type="textarea"
                        placeholder="Eg. 1234567890"
                        :rows="5"
                        style="width: 100%"
                      />
                    </div>
                  </div>

                  <div class="regex-pattern-test-string-container">
                    <FullViewContainer
                      name="output"
                      v-model:is-expanded="expandState.outputString"
                      label="Output"
                      class="tw:py-md tw:h-[24px]"
                      :labelClass="
                        store.state.theme === 'dark'
                          ? 'dark-test-string-container-label'
                          : 'light-test-string-container-label'
                      "
                    />
                    <div
                      v-if="expandState.outputString"
                      class="regex-pattern-input tw:mt-2"
                    >
                      <OInput
                        v-if="outputString.length > 0"
                        data-test="add-regex-test-string-input"
                        v-model="outputString"
                        class="regex-test-string-input"
                        :class="
                          store.state.theme === 'dark'
                            ? 'dark-mode-regex-test-string-input'
                            : 'light-mode-regex-test-string-input'
                        "
                        type="textarea"
                        placeholder="Output String"
                        :rows="5"
                        style="width: 100%"
                      />
                      <div
                        v-else
                        class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-[111px]"
                        :class="
                          store.state.theme === 'dark'
                            ? 'dark-mode-regex-no-output'
                            : 'light-mode-regex-no-output'
                        "
                      >
                        <div v-if="!testLoading && outputString.length === 0">
                          <OIcon
                            name="lightbulb"
                            size="md"
                            :class="
                              store.state.theme === 'dark'
                                ? 'tw:text-[#ffffff]'
                                : 'tw:text-[#A8A8A8]'
                            "
                          />
                          <span
                            class="tw:text-[12px] tw:font-[400] tw:text-center"
                            :class="
                              store.state.theme === 'dark'
                                ? 'tw:text-[#ffffff]'
                                : 'tw:text-[#4B5563]'
                            "
                          >
                            Please click Test Input to see the results
                          </span>
                        </div>
                        <div v-else-if="testLoading">
                          <span
                            class="tw:flex tw:items-center tw:justify-center tw:h-[111px]"
                          >
                            <OSpinner size="sm" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Add / Remove Pattern button — directly below Test Pattern card -->
            <div>
              <OButton
                variant="outline"
                size="sm-action"
                :data-test="checkIfPatternIsApplied(userClickedPattern.pattern_id) ? 'associated-regex-patterns-remove-pattern-btn' : 'associated-regex-patterns-add-pattern-btn'"
                @click="handleAddOrRemovePattern"
                :icon-left="
                  checkIfPatternIsApplied(userClickedPattern.pattern_id)
                    ? 'delete'
                    : 'add'
                "
              >
                {{
                  checkIfPatternIsApplied(userClickedPattern.pattern_id)
                    ? "Remove Pattern"
                    : "Add Pattern"
                }}
              </OButton>
            </div>
          </div>
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

import { defineComponent, nextTick, onMounted, onBeforeUnmount, PropType, ref, watch, computed } from 'vue';
import { useStore } from 'vuex';
import regexPatternsService from '@/services/regex_pattern';
import { convertUnixToQuasarFormat, getImageURL } from '@/utils/zincutils';
import { debounce } from "lodash-es";
import store from '@/test/unit/helpers/store';
import { useToast } from '@/lib/feedback/Toast/useToast';
import { useI18n } from 'vue-i18n';
import FullViewContainer from '../functions/FullViewContainer.vue';
import ConfirmDialog from '../ConfirmDialog.vue';
import OButton from '@/lib/core/Button/OButton.vue';
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

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
    OSeparator,
    FullViewContainer,
    ConfirmDialog,
    OButton,
    OSpinner,
    OInput,
    OSearchInput,
    ORadioGroup,
    ORadio,
    OCheckbox,
    OIcon,
    OCollapsible,
  },
  props: {
    data: {
      type: Array as PropType<PatternAssociation[]>,
      required: true,
    },
    fieldName: {
      type: String,
      required: true,
    },
  },
  emits: [
    "closeDialog",
    "addPattern",
    "removePattern",
    "updateSettings",
    "updateAppliedPattern",
  ],
  setup(props, { emit }) {
    const store = useStore();
    const filterPattern = ref("");
    const { t } = useI18n();
    const allPatterns = ref([]);
    const selectedPatterns = ref<any[]>([]);
    const listLoading = ref(false);
    const appliedPatterns = ref(props.data ? props.data : []);

    const filteredAppliedPatterns = computed(() => {
      if (!filterPattern.value) return appliedPatterns.value;
      const query = filterPattern.value.toLowerCase();
      return (appliedPatterns.value as any[]).filter((row: any) =>
        row?.pattern_name?.toLowerCase().includes(query),
      );
    });

    const filteredAllPatterns = computed(() => {
      if (!filterPattern.value) return allPatterns.value;
      const query = filterPattern.value.toLowerCase();
      return (allPatterns.value as any[]).filter((row: any) =>
        row?.name?.toLowerCase().includes(query),
      );
    });

    const resultTotal = computed(() => filteredAllPatterns.value.length);

    const allPatternsExpanded = ref(true);
    const appliedPatternsExpanded = ref(true);
    const appliedPatternsMap = ref(new Map());
    // Add a flag to track if patterns were added or removed
    const hasPatternChanges = ref(false);
    // Add a debounced emit function
    const debouncedEmit = debounce(
      (
        pattern: PatternAssociation,
        fieldName: string,
        patternId: string,
        attribute: string,
      ) => {
        emit("updateAppliedPattern", pattern, fieldName, patternId, attribute);
      },
      300,
    );
    const { toast } = useToast();
    const userClickedPattern = ref<any>(null);
    const isPatternValid = ref(false);
    const testString = ref("");
    const policy = ref("Redact");
    const apply_at = ref<any>([]);
    const appliedPatternsExpandedRef = ref(false);
    const allPatternsExpandedRef = ref(false);
    const isFormDirty = ref(false);
    const queryEditorRef = ref<any>(null);
    const testLoading = ref(false);
    const showWarningDialogToRemovePattern = ref(false);
    const outputString = ref("");
    const expandState = ref({
      regexTestString: true,
      outputString: false,
    });

    const testStringOutput = async () => {
      try {
        expandState.value.outputString = true;
        outputString.value = "";
        testLoading.value = true;
        const response = await regexPatternsService.test(
          store.state.selectedOrganization.identifier,
          userClickedPattern.value.pattern,
          [testString.value],
          policy.value,
        );
        outputString.value = response.data.results[0];
      } catch (error) {
        toast({
          variant: "error",
          message: error.response?.data?.message || "Failed to test string",
        });
      } finally {
        testLoading.value = false;
      }
    };

    const closeDialog = () => {
      hasPatternChanges.value = false;
      isFormDirty.value = false;
      emit("closeDialog");
    };

    onMounted(async () => {
      //if there are no regex patterns then we fetch them from the server
      //otherwise we use the cached regex patterns from the store
      if (store.state.organizationData.regexPatterns.length == 0) {
        await getRegexPatterns();
      } else {
        allPatterns.value = store.state.organizationData.regexPatterns.map(
          (pattern: any) => ({
            ...pattern,
            pattern_name: pattern.name,
            pattern_id: pattern.id,
            apply_at: "",
            policy: "",
            field: props.fieldName,
          }),
        );
      }
      // Initialize the applied patterns map
      appliedPatternsMap.value = new Map(
        props.data.map((p: any) => [p.pattern_id, p]),
      );
      //this is used to toggle the applied patterns and all patterns expansion items
      //so that we can show the applied patterns and all patterns in the applied patterns and all patterns list
      await nextTick();
      appliedPatternsExpandedRef.value = !appliedPatternsExpandedRef.value;
      allPatternsExpandedRef.value = !allPatternsExpandedRef.value;
      //this is done because we dont want to show the empty page at first when user lands at this page
      //so we select the first pattern from the applied patterns list if there are any applied patterns
      //other wise we show no pattern applied yet page
      if (props.data.length > 0) {
        userClickedPattern.value = props.data[0];
      }
    });

    watch(
      () => userClickedPattern.value,
      (newVal) => {
        if (!newVal) return;
        const appliedPattern = appliedPatternsMap.value.get(newVal.pattern_id);
        if (appliedPattern) {
          let applied_at_value = appliedPattern.apply_at;
          if (applied_at_value == "Both") {
            apply_at.value = ["AtIngestion", "AtSearch"];
          } else {
            apply_at.value = applied_at_value ? [applied_at_value] : [];
          }
          policy.value = appliedPattern.policy || "Redact";
        } else {
          apply_at.value = [];
          policy.value = "Redact";
        }
        resetInputValues();
      },
    );
    watch(
      () => props.data.length,
      () => {
        isFormDirty.value = true;
        appliedPatterns.value = [...props.data];
        appliedPatternsMap.value = new Map(
          props.data.map((p: any) => [p.pattern_id, p]),
        );
      },
    );
    watch(
      () => policy.value,
      (newVal) => {
        if (
          checkIfPatternIsAppliedAndUpdate(userClickedPattern.value.pattern_id)
        ) {
          let updatedPattern = {
            ...userClickedPattern.value,
            policy: newVal,
          };
          debouncedEmit(
            updatedPattern,
            props.fieldName,
            userClickedPattern.value.pattern_id,
            "policy",
          );
        }
      },
    );
    watch(
      () => apply_at.value,
      (newVal) => {
        if (
          checkIfPatternIsAppliedAndUpdate(userClickedPattern.value.pattern_id)
        ) {
          if (newVal.length == 0) {
            showWarningToRemovePattern();
          }
          let apply_at_value = "";
          if (newVal.length == 2) {
            apply_at_value = "Both";
          } else {
            apply_at_value = newVal[0];
          }
          let updatedPattern = {
            ...userClickedPattern.value,
            apply_at: apply_at_value,
          };
          debouncedEmit(
            updatedPattern,
            props.fieldName,
            userClickedPattern.value.pattern_id,
            "apply_at",
          );
        }
      },
    );

    const getRegexPatterns = async () => {
      listLoading.value = true;
      try {
        const response = await regexPatternsService.list(
          store.state.selectedOrganization.identifier,
        );
        let counter = 1;
        allPatterns.value = response.data.patterns.map((pattern: any) => ({
          ...pattern,
          "#": counter <= 9 ? `0${counter++}` : counter++,
          created_at: convertUnixToQuasarFormat(pattern.created_at),
          updated_at: convertUnixToQuasarFormat(pattern.updated_at),
          pattern_name: pattern.name,
          pattern_id: pattern.id,
          field: props.fieldName,
        }));
        store.dispatch("setRegexPatterns", allPatterns.value);
      } catch (error) {
        toast({
          variant: "error",
          message:
            error?.response?.data?.message ||
            error?.data?.message ||
            "Error fetching regex patterns",
        });
      } finally {
        listLoading.value = false;
      }
    };
    const checkIfPatternIsApplied = (patternId: string) => {
      // Use Map for O(1) lookup instead of array search
      return appliedPatternsMap.value.has(patternId);
    };
    const handlePatternClick = (pattern: any) => {
      userClickedPattern.value = pattern;
    };
    const checkCurrentUserClickedPattern = (patternName: string) => {
      return userClickedPattern.value?.pattern_name === patternName;
    };

    //used filter method to filter the patterns based on the name
    const handleFilterMethod = (rows: any[], terms: string) => {
      const lowerTerm = terms.toLowerCase();
      return rows.filter((row) => row?.name?.toLowerCase().includes(lowerTerm));
    };

    const updateRegexPattern = () => {
      emit("updateSettings");
      isFormDirty.value = false;
      // Reset the pattern changes flag after update
      hasPatternChanges.value = false;
    };

    //this is used to add or remove a pattern from the field
    //if the pattern is already applied then we remove it
    //otherwise we add it
    const handleAddOrRemovePattern = () => {
      if (checkIfPatternIsApplied(userClickedPattern.value.pattern_id)) {
        //remove pattern
        emit(
          "removePattern",
          userClickedPattern.value.pattern_id,
          props.fieldName,
        );
        appliedPatterns.value = appliedPatterns.value.filter(
          (pattern: any) =>
            pattern.pattern_id !== userClickedPattern.value.pattern_id,
        );
        appliedPatternsMap.value.delete(userClickedPattern.value.pattern_id);
        // Set flag when pattern is removed
        hasPatternChanges.value = true;
        isFormDirty.value = true;
      } else {
        if (apply_at.value.length == 0) {
          toast({
            variant: "error",
            message: "Please select detect at option",
          });
          return;
        }
        let apply_at_value = "";
        //add pattern
        if (apply_at.value.length == 2) {
          apply_at_value = "Both";
        } else {
          apply_at_value = apply_at.value[0];
        }
        const pattern = {
          field: props.fieldName,
          pattern_name: userClickedPattern.value.pattern_name,
          pattern_id: userClickedPattern.value.pattern_id,
          policy: policy.value,
          apply_at: apply_at_value,
          pattern: userClickedPattern.value.pattern,
          description: userClickedPattern.value.description,
        };
        emit("addPattern", pattern);
        // Let the watcher handle updating appliedPatterns
        appliedPatternsMap.value.set(pattern.pattern_id, pattern);
        // Set flag when pattern is added
        hasPatternChanges.value = true;
        isFormDirty.value = true;
      }
      //this is for safety to close the warning dialog whenever user clicks on add or remove pattern button
      showWarningDialogToRemovePattern.value = false;
    };
    //why this check because user might update the policy or apply_at value of already applied pattern
    //so we need to check if the policy or apply_at value is changed and if it is then we need to update the isFormDirty value
    //so that the user can see the update changes button
    //after this we need to add the logic to add this to add array
    const checkIfPatternIsAppliedAndUpdate = (patternId: string) => {
      // Use Map for O(1) lookup instead of array search
      const applied_pattern = appliedPatternsMap.value.get(patternId);
      let apply_at_value = "";
      if (apply_at.value.length == 2) {
        apply_at_value = "Both";
      } else {
        apply_at_value = apply_at.value[0] || "";
      }
      if (applied_pattern) {
        // Only update isFormDirty if there are no pattern add/remove changes
        if (!hasPatternChanges.value) {
          isFormDirty.value =
            applied_pattern.policy !== policy.value ||
            applied_pattern.apply_at !== apply_at_value;
        }
        return true;
      }
      return false;
    };

    // Keep appliedPatternsMap in sync with appliedPatterns
    watch(
      () => props.data,
      (newVal) => {
        appliedPatternsMap.value = new Map(
          newVal.map((p) => [p.pattern_id, p]),
        );
      },
      { immediate: true },
    );

    const resetInputValues = () => {
      testString.value = "";
      outputString.value = "";
      expandState.value.outputString = false;
      expandState.value.regexTestString = true;
    };

    const showWarningToRemovePattern = () => {
      //here we need to show the user the previous value of apply_at
      //if user clicks on no then we need to show the user the previous value of apply_at
      //otherwise we need to remove the pattern from the field
      showWarningDialogToRemovePattern.value = true;
    };

    const handleCancelRemovePattern = async () => {
      showWarningDialogToRemovePattern.value = false;
      //we need to get the previous value of apply_at values
      //and set it to the apply_at value
      //we need to get the previous value of apply_at values
      //so we are transforming the apply_at value to the previous value of apply_at values
      apply_at.value = transformApplyAtValue(
        userClickedPattern.value?.apply_at,
      );
    };

    const transformApplyAtValue = (applyAtValue: string) => {
      let applyAtValues = [];
      if (applyAtValue == "Both") {
        applyAtValues = ["AtIngestion", "AtSearch"];
      } else {
        applyAtValues = [applyAtValue];
      }
      return applyAtValues;
    };

    return {
      store,
      closeDialog,
      filterPattern,
      selectedPatterns,
      allPatterns,
      allPatternsExpanded,
      listLoading,
      resultTotal,
      filteredAppliedPatterns,
      filteredAllPatterns,
      getRegexPatterns,
      appliedPatterns,
      appliedPatternsExpanded,
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
      outlinedLightbulb: "lightbulb",
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
    };
  },
});
</script>

<style lang="scss">
.breadcrumb-text {
  font-size: 18px;
  font-weight: 400;
  line-height: 24px;
}
.associated-field-name {
  font-size: 18px;
  font-weight: 400;
  line-height: 24px;
}
.light-regex-patterns {
  .breadcrumb-text {
    color: #5960b2;
  }
  .associated-field-name {
    color: #000;
  }
}
.dark-regex-patterns {
  .breadcrumb-text {
    color: #5960b2;
  }
  .associated-field-name {
    color: #fff;
  }
}

.individual-section-title {
  font-size: 14px;
  font-weight: 600;
}
.individual-section-title-main {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}
.individual-section-sub-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 24px;
}
.individual-section-sub-title2 {
  font-size: 14px;
  font-weight: 600;
  line-height: 24px;
}
.individual-section-sub-information {
  font-size: 14px;
  font-weight: 400;
  line-height: 24px;
}
.regex-pattern-text {
  font-size: 12px;
  font-weight: 400;
  line-height: 24px;
  word-wrap: break-word;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.individual-section-title,
.individual-section-sub-title2 {
  color: var(--o2-text-secondary);
}
.light-regex-patterns {
  .individual-section-sub-title {
    color: #000000;
  }
  .individual-section-sub-information {
    color: #000000;
  }
  .individual-section-value {
    color: #000000;
  }
  .regex-pattern-text {
    color: #5a5a5a;
  }
}
.dark-regex-patterns {
  .individual-section-value {
    color: #ffffff;
  }
}
.add-remove-pattern-button-light {
  color: #5960b2;
  border: 1px solid #5960b2;
  width: fit-content;
}
.add-remove-pattern-button-dark {
  color: #5960b2;
  border: 1px solid #5960b2;
  width: fit-content;
}

.regex-test-string-input > div > div > div > textarea {
  resize: none !important;
}
.is-pattern-valid > div > div {
  .q-field__native {
    color: green !important;
  }
}

.selected-pattern-row {
  color: var(--o2-tab-text-color);
  background-color: var(--o2-tab-bg);
}
.dark-associated-regex-patterns-table {
  background-color: #1f1f1f !important;
}
.associated-regex-patterns-table {
  .q-table__card {
    border-radius: 0px !important;
  }
}
.regex-pattern-name {
  white-space: nowrap;
  overflow: hidden;
  max-width: 10vw;
  text-overflow: ellipsis;
  text-transform: none !important;
}
.no-pattern-applied-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 32px;
}
.no-pattern-applied-subtitle {
  font-size: 14px;
  font-weight: 400;
  line-height: 12px;
}
.regex-pattern-associated-test-string-editor {
  .lines-content {
    padding-left: 12px !important;
  }
}
.dark-mode-regex-test-string-input .q-field__control {
  background-color: #181a1b !important;
  border-top: 1px solid #666666 !important;
  border-left: 1px solid #666666 !important;
  border-right: 1px solid #666666 !important;
  border-bottom: 1px solid #666666 !important;
}
.light-mode-regex-test-string-input .q-field__control {
  background-color: #ffffff !important;
  border-top: 1px solid #e6e6e6 !important;
  border-left: 1px solid #e6e6e6 !important;
  border-right: 1px solid #e6e6e6 !important;
  border-bottom: 1px solid #e6e6e6 !important;
}
.light-mode-regex-associated-test-string-input .monaco-editor-background {
  background-color: #ffffff !important;
}
.dark-mode-regex-associated-test-string-input .monaco-editor-background {
  background-color: #1f1f1f !important;
}
.dark-mode-regex-no-output {
  background-color: #181a1b !important;
  border-left: 2px solid #212121 !important;
  border-right: 2px solid #212121 !important;
  border-bottom: 2px solid #212121 !important;
}
.light-mode-regex-no-output {
  background-color: #ffffff !important;
  border-left: 1px solid #e6e6e6 !important;
  border-right: 1px solid #e6e6e6 !important;
  border-bottom: 1px solid #e6e6e6 !important;
}
</style>
