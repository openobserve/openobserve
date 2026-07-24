<template>
  <div style="width: 60vw; height: calc(100vh - 59px)" :class="'bg-surface-base'">
    <div class="flex flex-nowrap items-center justify-between px-4 py-2">
      <div class="flex items-center">
        <div class="col-auto"></div>
        <div class="flex items-center" data-test="associated-regex-patterns-title-text">
          <span
            class="breadcrumb-text text-brand-indigo cursor-pointer text-lg leading-6 font-normal"
            @click="closeDialog"
            >{{ t("regex_patterns.associated_breadcrumb") }} &gt; &nbsp;
          </span>
          <span class="associated-field-name text-text-heading text-lg leading-6 font-normal">
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
    <div class="flex w-full">
      <!-- here we will have the left side section -->
      <div class="w-[25%]">
        <div class="flex flex-col px-2 py-2">
          <div>
            <OSearchInput
              data-test="associated-regex-patterns-search-input"
              v-model="filterPattern"
              data-cy="schema-index-field-search-input"
              :placeholder="t('regex_patterns.associated_search_placeholder')"
              clearable
            />
          </div>
          <div style="height: calc(100vh - 130px)" class="overflow-y-auto">
            <div class="pattern-list-wrapper">
              <OCollapsible
                v-model="appliedPatternsExpandedRef"
                :label="
                  t('regex_patterns.applied_patterns_count', { count: appliedPatterns.length })
                "
                class="mt-2 text-sm font-[600]"
                data-test="associated-regex-patterns-applied-patterns-expansion-item"
              >
                <div
                  v-if="filteredAppliedPatterns.length === 0"
                  class="px-2 py-3 text-xs opacity-50"
                  data-test="associated-regex-patterns-applied-patterns-table"
                >
                  {{ t("regex_patterns.no_data_available") }}
                </div>
                <ul
                  v-else
                  class="m-0 list-none p-0"
                  data-test="associated-regex-patterns-applied-patterns-table"
                >
                  <li
                    v-for="row in filteredAppliedPatterns"
                    :key="row.pattern_id"
                    :data-test="`associated-regex-patterns-applied-patterns-table-row-${row.pattern_id}`"
                    class="text-compact flex cursor-pointer items-center justify-between border-b px-2 py-2.5 font-[600]"
                    :class="
                      checkCurrentUserClickedPattern(row.pattern_name)
                        ? 'text-tab-text-color bg-theme-tab-bg'
                        : ''
                    "
                    @click="handlePatternClick(row)"
                  >
                    <span
                      class="regex-pattern-name max-w-[10vw] truncate overflow-hidden whitespace-nowrap normal-case!"
                      >{{ row.pattern_name }}</span
                    >
                    <OIcon name="check" size="xs" />
                  </li>
                </ul>
              </OCollapsible>
            </div>
            <OSeparator class="mt-2" />
            <div class="pattern-list-wrapper">
              <OCollapsible
                v-model="allPatternsExpandedRef"
                :label="t('regex_patterns.all_patterns_count', { count: resultTotal })"
                class="mt-2 text-sm font-[600]"
                data-test="associated-regex-patterns-all-patterns-expansion-item"
              >
                <ul
                  class="m-0 list-none p-0"
                  data-test="associated-regex-patterns-all-patterns-table"
                >
                  <li
                    v-for="row in filteredAllPatterns"
                    :key="row.pattern_id"
                    :data-test="`associated-regex-patterns-all-patterns-table-row-${row.pattern_id}`"
                    class="text-compact flex cursor-pointer items-center justify-between border-b px-2 py-2.5 font-[600]"
                    :class="
                      checkCurrentUserClickedPattern(row.pattern_name)
                        ? 'text-tab-text-color bg-theme-tab-bg'
                        : ''
                    "
                    @click="handlePatternClick(row)"
                  >
                    <span
                      class="regex-pattern-name max-w-[10vw] truncate overflow-hidden whitespace-nowrap normal-case!"
                      >{{ row.pattern_name }}</span
                    >
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
      <div class="flex w-[75%] flex-col" style="height: calc(100vh - 59px)">
        <div class="flex-1 overflow-y-auto pt-3">
          <div
            v-if="!userClickedPattern"
            class="flex h-full flex-col items-center justify-center gap-4 px-6 py-12"
          >
            <img
              data-test="associated-regex-patterns-no-pattern-image"
              :src="getImageURL('images/regex_pattern/no_applied_pattern.svg')"
              style="width: 125px"
              alt=""
            />
            <span
              class="text-base leading-8 font-semibold"
              data-test="associated-regex-patterns-no-pattern-applied-title"
              >{{ t("regex_patterns.no_patterns_applied_title") }}</span
            >
            <span
              class="text-center text-sm leading-3 font-normal"
              data-test="associated-regex-patterns-no-pattern-applied-subtitle"
              >{{ t("regex_patterns.no_patterns_applied_subtitle") }}</span
            >
          </div>
          <div v-else class="flex flex-col gap-3 px-3 pb-4">
            <!-- Pattern Info Card -->
            <div
              class="section-card rounded-default bg-surface-subtle border-border-default border p-3"
            >
              <div class="flex flex-col gap-2">
                <div class="flex flex-col gap-1">
                  <span class="individual-section-title text-text-secondary text-xs font-[500]">
                    {{ t("regex_patterns.pattern_name") }}
                  </span>
                  <span
                    class="individual-section-value text-text-body text-sm font-[700]"
                    data-test="associated-regex-patterns-pattern-name"
                  >
                    {{ userClickedPattern.pattern_name }}
                  </span>
                </div>

                <OSeparator />

                <div class="flex flex-col gap-1">
                  <span class="individual-section-title text-text-secondary text-xs font-[500]">
                    {{ t("regex_patterns.description") }}
                  </span>
                  <span
                    class="individual-section-value text-text-body text-sm font-[700]"
                    data-test="associated-regex-patterns-pattern-description"
                  >
                    {{
                      userClickedPattern.description
                        ? userClickedPattern.description
                        : t("regex_patterns.no_description")
                    }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Configuration Card -->
            <div
              class="section-card rounded-default bg-surface-subtle border-border-default border p-3"
            >
              <div class="flex gap-4">
                <!-- when value matches -->
                <div class="flex flex-1 flex-col gap-1.5">
                  <span class="individual-section-title text-text-secondary text-xs font-[500]">
                    {{ t("regex_patterns.when_value_matches") }}
                  </span>
                  <ORadioGroup v-model="policy">
                    <div class="flex flex-col gap-1">
                      <div class="flex items-center gap-2">
                        <ORadio
                          value="Redact"
                          data-test="associated-regex-patterns-redact-radio"
                          size="sm"
                        />
                        <span class="text-compact font-[600]">{{
                          t("regex_patterns.redact")
                        }}</span>
                        <span class="text-xs font-[400] opacity-60">{{
                          t("regex_patterns.redact_hint")
                        }}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <ORadio
                          value="DropField"
                          data-test="associated-regex-patterns-drop-field-radio"
                          size="sm"
                        />
                        <span class="text-compact font-[600]">{{ t("regex_patterns.drop") }}</span>
                        <span class="text-xs font-[400] opacity-60">{{
                          t("regex_patterns.drop_hint")
                        }}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <ORadio
                          value="Hash"
                          data-test="associated-regex-patterns-hash-radio"
                          size="sm"
                        />
                        <span class="text-compact font-[600]">{{ t("regex_patterns.hash") }}</span>
                        <span class="text-xs font-[400] opacity-60">{{
                          t("regex_patterns.hash_hint")
                        }}</span>
                      </div>
                    </div>
                  </ORadioGroup>
                </div>

                <OSeparator vertical />

                <!-- detect at section -->
                <div class="flex min-w-30 flex-col gap-1.5">
                  <span class="individual-section-title text-text-secondary text-xs font-[500]">
                    {{ t("regex_patterns.detect_at") }}
                  </span>
                  <div class="flex flex-col gap-1.5">
                    <OCheckbox
                      size="sm"
                      v-model="apply_at"
                      val="AtIngestion"
                      :label="t('regex_patterns.ingestion')"
                      data-test="associated-regex-patterns-ingestion-checkbox"
                    />
                    <OCheckbox
                      size="sm"
                      v-model="apply_at"
                      val="AtSearch"
                      :label="t('regex_patterns.query')"
                      data-test="associated-regex-patterns-query-checkbox"
                    />
                  </div>
                </div>
              </div>
            </div>

            <OSeparator />

            <!-- Test Pattern Card -->
            <div
              class="section-card rounded-default bg-surface-subtle border-border-default border p-3"
            >
              <div class="flex flex-col gap-2.5">
                <div class="flex items-center justify-between">
                  <span class="text-compact leading-6 font-bold">
                    {{ t("regex_patterns.test_pattern") }}
                  </span>
                  <OButton
                    :disabled="testString.length === 0 || testLoading"
                    variant="primary"
                    size="sm-action"
                    @click="testStringOutput"
                  >
                    <span class="text-xs">{{ t("regex_patterns.test_input") }}</span>
                  </OButton>
                </div>

                <div class="flex flex-col gap-1">
                  <span class="text-text-secondary text-xs leading-6 font-medium">
                    {{ t("regex_patterns.regex_pattern_label") }}
                  </span>
                  <div class="rounded-default text-2xs bg-surface-base p-2 font-mono break-all">
                    <span
                      class="regex-pattern-text overflow-wrap-anywhere text-text-secondary text-xs leading-6 font-normal break-all whitespace-pre-wrap"
                      data-test="associated-regex-patterns-regex-pattern"
                    >
                      {{ userClickedPattern.pattern }}
                    </span>
                  </div>
                </div>

                <OSeparator />

                <div class="flex flex-col gap-2">
                  <div class="regex-pattern-test-string-container">
                    <FullViewContainer
                      name="query"
                      v-model:is-expanded="expandState.regexTestString"
                      :label="t('regex_patterns.input_string')"
                      class="py-md h-6"
                    />
                    <div v-if="expandState.regexTestString" class="regex-pattern-input mt-2">
                      <OInput
                        data-test="add-regex-test-string-input"
                        v-model="testString"
                        class="regex-test-string-input w-full"
                        type="textarea"
                        :placeholder="t('regex_patterns.input_string_placeholder')"
                        :rows="5"
                      />
                    </div>
                  </div>

                  <div class="regex-pattern-test-string-container">
                    <FullViewContainer
                      name="output"
                      v-model:is-expanded="expandState.outputString"
                      :label="t('regex_patterns.output')"
                      class="py-md h-6"
                    />
                    <div v-if="expandState.outputString" class="regex-pattern-input mt-2">
                      <OInput
                        v-if="outputString.length > 0"
                        data-test="add-regex-test-string-input"
                        v-model="outputString"
                        class="regex-test-string-input w-full"
                        type="textarea"
                        :placeholder="t('regex_patterns.output_string_placeholder')"
                        :rows="5"
                      />
                      <div
                        v-else
                        class="bg-surface-base flex h-27.75 flex-col items-center justify-center [border-bottom:1px_solid_var(--color-border-default)] [border-left:1px_solid_var(--color-border-default)] [border-right:1px_solid_var(--color-border-default)]"
                      >
                        <div v-if="!testLoading && outputString.length === 0">
                          <OIcon name="lightbulb" size="md" class="text-icon-color" />
                          <span class="text-text-secondary text-center text-xs font-[400]">
                            {{ t("regex_patterns.click_test_input_hint") }}
                          </span>
                        </div>
                        <div v-else-if="testLoading">
                          <span class="flex h-27.75 items-center justify-center">
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
                :data-test="
                  checkIfPatternIsApplied(userClickedPattern.pattern_id)
                    ? 'associated-regex-patterns-remove-pattern-btn'
                    : 'associated-regex-patterns-add-pattern-btn'
                "
                @click="handleAddOrRemovePattern"
                :icon-left="
                  checkIfPatternIsApplied(userClickedPattern.pattern_id) ? 'delete' : 'add'
                "
              >
                {{
                  checkIfPatternIsApplied(userClickedPattern.pattern_id)
                    ? t("regex_patterns.remove_pattern")
                    : t("regex_patterns.add_pattern")
                }}
              </OButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <ConfirmDialog
    :title="t('regex_patterns.remove_pattern')"
    :message="t('regex_patterns.remove_pattern_confirm_msg')"
    @update:ok="handleAddOrRemovePattern"
    @update:cancel="handleCancelRemovePattern"
    v-model="showWarningDialogToRemovePattern"
  />
</template>

<script lang="ts">
import { defineComponent, nextTick, onMounted, PropType, ref, watch, computed } from "vue";
import { useStore } from "vuex";
import regexPatternsService from "@/services/regex_pattern";
import { convertUnixToDateFormat, getImageURL } from "@/utils/zincutils";
import { debounce } from "lodash-es";
import { useToast } from "@/lib/feedback/Toast/useToast";
import { useI18n } from "vue-i18n";
import FullViewContainer from "../functions/FullViewContainer.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

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
  emits: ["closeDialog", "addPattern", "removePattern", "updateSettings", "updateAppliedPattern"],
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
      (pattern: PatternAssociation, fieldName: string, patternId: string, attribute: string) => {
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
        const e = error as { response?: { data?: { message?: string } } };
        toast({
          variant: "error",
          message: e.response?.data?.message || t("regex_patterns.failed_to_test_string"),
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
        allPatterns.value = store.state.organizationData.regexPatterns.map((pattern: any) => ({
          ...pattern,
          pattern_name: pattern.name,
          pattern_id: pattern.id,
          apply_at: "",
          policy: "",
          field: props.fieldName,
        }));
      }
      // Initialize the applied patterns map
      appliedPatternsMap.value = new Map(props.data.map((p: any) => [p.pattern_id, p]));
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
        appliedPatternsMap.value = new Map(props.data.map((p: any) => [p.pattern_id, p]));
      },
    );
    watch(
      () => policy.value,
      (newVal) => {
        if (checkIfPatternIsAppliedAndUpdate(userClickedPattern.value.pattern_id)) {
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
        if (checkIfPatternIsAppliedAndUpdate(userClickedPattern.value.pattern_id)) {
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
        allPatterns.value = response.data.patterns.map((pattern: any) => ({
          ...pattern,
          created_at: convertUnixToDateFormat(pattern.created_at),
          updated_at: convertUnixToDateFormat(pattern.updated_at),
          pattern_name: pattern.name,
          pattern_id: pattern.id,
          field: props.fieldName,
        }));
        store.dispatch("setRegexPatterns", allPatterns.value);
      } catch (error) {
        const e = error as {
          response?: { data?: { message?: string } };
          data?: { message?: string };
        };
        toast({
          variant: "error",
          message:
            e?.response?.data?.message || e?.data?.message || "Error fetching regex patterns",
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
        emit("removePattern", userClickedPattern.value.pattern_id, props.fieldName);
        appliedPatterns.value = appliedPatterns.value.filter(
          (pattern: any) => pattern.pattern_id !== userClickedPattern.value.pattern_id,
        );
        appliedPatternsMap.value.delete(userClickedPattern.value.pattern_id);
        // Set flag when pattern is removed
        hasPatternChanges.value = true;
        isFormDirty.value = true;
      } else {
        if (apply_at.value.length == 0) {
          toast({
            variant: "error",
            message: t("regex_patterns.select_detect_at_option"),
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
            applied_pattern.policy !== policy.value || applied_pattern.apply_at !== apply_at_value;
        }
        return true;
      }
      return false;
    };

    // Keep appliedPatternsMap in sync with appliedPatterns
    watch(
      () => props.data,
      (newVal) => {
        appliedPatternsMap.value = new Map(newVal.map((p) => [p.pattern_id, p]));
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
      apply_at.value = transformApplyAtValue(userClickedPattern.value?.apply_at);
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

<style scoped>
/* keep(complex-state): :deep override to disable resize on the child input's textarea */
.regex-test-string-input :deep(textarea) {
  resize: none !important;
}

/* keep(lib-override:o2-input): squares the top corners of the textarea's own
   border box (OInput's internal wrapper div, only reachable via :deep()) so each
   field reads as one unit under its flat full-width section-header strip. */
.regex-pattern-input :deep(.rounded-default.border),
.regex-test-string-input :deep(.rounded-default.border) {
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
}
</style>
