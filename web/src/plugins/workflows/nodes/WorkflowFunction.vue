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

<!--
  Function node body (drawer content only — chrome lives in WorkflowNodeDrawer).
  Mirrors pipeline's AssociateFunction: pick a saved VRL function to reshape the
  alert payload and preview its definition (or create one inline). Only VRL
  functions (trans_type !== 1) are usable, same as pipelines. There's no
  flattening concept in workflows, so no after-flatten toggle.

  Data payload -> NodeData::Function { name }.
  WorkflowNodeDrawer's Save calls submit(), which returns that payload or null
  when no function is selected.
-->
<template>
  <div
    data-test="workflow-function-body"
    class="tw:w-full tw:flex tw:flex-col tw:gap-4"
    :class="createNewFunction ? 'tw:h-full tw:min-h-0 tw:gap-0' : ''"
  >
    <OSpinner v-if="loading" size="md" class="tw:mx-auto tw:my-8" />

    <template v-else>
      <!-- Create new / pick existing toggle (pipeline AssociateFunction pattern) -->
      <div
        class="tw:flex tw:items-center tw:gap-3"
        :class="createNewFunction ? 'tw:px-4 tw:pt-4 tw:shrink-0' : ''"
      >
        <OSwitch
          v-model="createNewFunction"
          :label="t('workflow.node.functionCreateNew')"
          data-test="workflow-function-create-toggle"
        />
      </div>

      <!-- inline function editor (full-width drawer, own toolbar save/cancel) -->
      <div
        v-if="createNewFunction"
        class="workflow-add-function tw:flex-1 tw:min-h-0 tw:w-full"
      >
        <AddFunction
          ref="addFunctionRef"
          :is-updated="false"
          :height-offset="75"
          @update:list="onFunctionCreation"
          @cancel:hideform="cancelFunctionCreation"
        />
      </div>

      <template v-if="!createNewFunction">
      <OSelect
        v-model="selectedFunction"
        :options="functionOptions"
        :label="t('workflow.node.functionSelect') + ' *'"
        searchable
        :error="showRequiredError && !selectedFunction"
        :error-message="
          showRequiredError && !selectedFunction
            ? t('workflow.node.functionRequired')
            : ''
        "
        data-test="workflow-function-select"
      />

      <!-- Selected function definition (read-only) — same card as pipeline's
           AssociateFunction. -->
      <div
        v-if="selectedFunction && selectedDefinition"
        data-test="workflow-function-definition"
        class="tw:mt-4 tw:mb-4"
      >
        <OCard class="function-definition-card tw:border tw:border-[#e1e5e9] tw:dark:border-[#2d3748] tw:rounded-lg tw:overflow-hidden tw:dark:bg-[#1a202c]">
          <OCardSection role="header" class="tw:bg-[linear-gradient(135deg,#f8fafc_0%,#f1f5f9_100%)] tw:dark:bg-[linear-gradient(135deg,#2d3748_0%,#1a202c_100%)] tw:border-b tw:border-b-[#e2e8f0] tw:dark:border-b-[#4a5568]">
            <div class="tw:text-base tw:font-semibold tw:text-[#2d3748] tw:dark:text-white">
              {{ t("function.function_definition") }}
            </div>
          </OCardSection>
          <OSeparator />
          <OCardSection class="tw:p-0">
            <div class="function-code-container tw:bg-[#fafbfc] tw:dark:bg-[#0d1117] tw:dark:border tw:dark:border-[#21262d] tw:max-h-[250px] tw:overflow-y-auto tw:relative">
              <pre class="function-code tw:text-[#2d3748] tw:dark:text-[#f7fafc] tw:bg-transparent tw:m-0 tw:p-4 tw:text-[13px] tw:leading-normal tw:whitespace-pre-wrap tw:break-words tw:border-0 tw:font-normal tw:cursor-default tw:select-text">{{ selectedDefinition }}</pre>
            </div>
          </OCardSection>
        </OCard>
      </div>
      </template>
    </template>
  </div>
</template>

<script lang="ts" setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import functionsService from "@/services/jstransform";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";

const AddFunction = defineAsyncComponent(
  () => import("@/components/functions/AddFunction.vue"),
);

const { t } = useI18n();
const store = useStore();

const savedData = workflowObj.currentSelectedNodeData?.data || {};

const loading = ref(false);
const functionOptions = ref<string[]>([]);
// name -> function definition string, for the read-only preview.
const functionDefs = ref<Record<string, string>>({});

const selectedFunction = ref<string>(savedData.name || "");
const showRequiredError = ref(false);

// Inline "Create New Function" editor. While on, the drawer goes full-width and
// hides its own footer — AddFunction's toolbar owns save/cancel.
const createNewFunction = ref(false);
const addFunctionRef = ref<any>(null);
watch(createNewFunction, (v) => {
  workflowObj.dialog.expand = v;
});
onBeforeUnmount(() => {
  workflowObj.dialog.expand = false;
});

watch(selectedFunction, (v) => {
  if (v) showRequiredError.value = false;
});

const selectedDefinition = computed(
  () => functionDefs.value[selectedFunction.value] || "",
);

// Load saved VRL functions (skip JS functions, trans_type === 1) — same call
// PipelineEditor uses to populate its function palette.
const getFunctions = async () => {
  loading.value = true;
  try {
    const res = await functionsService.list(
      1,
      100000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
    );
    const names: string[] = [];
    const defs: Record<string, string> = {};
    (res.data?.list || []).forEach((func: any) => {
      if (func.trans_type !== 1) {
        names.push(func.name);
        defs[func.name] = func.function;
      }
    });
    functionOptions.value = names.sort((a, b) => a.localeCompare(b));
    functionDefs.value = defs;
  } catch (e) {
    toast({ variant: "error", message: t("workflow.node.functionLoadError") });
  } finally {
    loading.value = false;
  }
};

onMounted(getFunctions);

// AddFunction saved a new function: leave create-mode, refresh the list, and
// auto-select the newly created function.
const onFunctionCreation = async (fn: any) => {
  createNewFunction.value = false;
  await getFunctions();
  await nextTick();
  if (fn?.name) selectedFunction.value = fn.name;
};

// AddFunction's toolbar back/cancel: return to the picker (don't close the node
// drawer).
const cancelFunctionCreation = () => {
  createNewFunction.value = false;
};

// Called by WorkflowNodeDrawer on Save. Returns the data payload or null.
// No flattening concept in workflows, so we only carry the function name.
const submit = () => {
  if (!selectedFunction.value) {
    showRequiredError.value = true;
    return null;
  }
  return { name: selectedFunction.value };
};

defineExpose({ submit });
</script>

<style scoped>
/* Hide AddFunction's own title/back/fullscreen chrome inside the drawer (the
   drawer supplies the title) — same overrides pipeline's AssociateFunction uses. */
.workflow-add-function :deep(.add-function-back-btn),
.workflow-add-function :deep(.add-function-fullscreen-btn),
.workflow-add-function :deep(.add-function-title) {
  display: none;
}
.workflow-add-function :deep(.add-function-name-input) {
  width: 100%;
  margin-left: 0 !important;
}

/* Function definition code preview — same as pipeline's AssociateFunction. */
.function-code {
  font-family: JetBrains Mono, Fira Code, Monaco, Menlo, Ubuntu Mono, monospace;
}
.function-code::selection {
  background-color: #bee3f8;
}
.function-code-container::-webkit-scrollbar {
  width: 6px;
}
.function-code-container::-webkit-scrollbar-track {
  background: #f7fafc;
}
.function-code-container::-webkit-scrollbar-thumb {
  background: #cbd5e0;
  border-radius: 3px;
}
.function-code-container::-webkit-scrollbar-thumb:hover {
  background: #a0aec0;
}
</style>
