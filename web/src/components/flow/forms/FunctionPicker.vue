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
  Shared "pick a VRL function" body for the flow canvases (Pipelines + Workflows).
  Presentation + logic only — the surrounding chrome (drawer / modal + Save/Cancel)
  lives in each module's wrapper, which reads the result via the exposed
  `getPayload()`.

  Behaviour:
   - Toggle between picking a saved VRL function and creating one inline (AddFunction).
   - Read-only definition preview of the selected function.
   - Optional "After Flattening" (RAF/RBF) toggle — shown when `showFlatten`.
   - Self-fetches the VRL function list (trans_type !== 1), so callers don't have
     to thread it through.

  Props:
    initialName          — preselected function name (edit mode)
    initialAfterFlatten  — initial RAF/RBF value (default true)
    showFlatten          — show the After-Flattening toggle + guidelines (default true)
    isUpdating           — lock the select (edit-an-existing-function mode)
    duplicateNames       — names that are already used → shows "already associated"

  Emits:
    expand(boolean)  — inline-create mode toggled (host can widen the drawer)
    created(fn)      — a new function was created inline

  Exposes:
    getPayload()  — { name, after_flatten? } or null (and surfaces validation)
-->
<template>
  <div
    data-test="function-picker"
    class="tw:w-full tw:flex tw:flex-col tw:gap-4"
    :class="createNewFunction ? 'tw:h-full tw:min-h-0 tw:gap-0' : ''"
  >
    <OSpinner v-if="loading" size="md" class="tw:mx-auto tw:my-8" />

    <template v-else>
      <!-- create / pick toggle -->
      <div
        class="tw:flex tw:items-center tw:gap-3"
        :class="createNewFunction ? 'tw:px-4 tw:pt-4 tw:shrink-0' : ''"
      >
        <OSwitch
          v-model="createNewFunction"
          :label="t('flow.function.createNew')"
          data-test="function-picker-create-toggle"
        />
      </div>

      <!-- inline function editor (full-width; its own toolbar owns save/cancel) -->
      <div
        v-if="createNewFunction"
        class="flow-add-function tw:flex-1 tw:min-h-0 tw:w-full"
      >
        <AddFunction
          ref="addFunctionRef"
          :is-updated="isUpdating"
          :height-offset="75"
          :sample-events="sampleEvents"
          @update:list="onFunctionCreation"
          @cancel:hideform="cancelFunctionCreation"
        />
      </div>

      <template v-if="!createNewFunction">
        <OSelect
          v-model="selectedFunction"
          :options="functionOptions"
          :label="t('flow.function.select') + ' *'"
          searchable
          :readonly="isUpdating"
          :disabled="isUpdating"
          :error="functionExists || (showRequiredError && !selectedFunction)"
          :error-message="
            functionExists
              ? t('flow.function.duplicate')
              : showRequiredError && !selectedFunction
                ? t('flow.function.required')
                : ''
          "
          data-test="function-picker-select"
        />

        <!-- read-only definition preview -->
        <div
          v-if="selectedFunction && selectedDefinition"
          data-test="function-picker-definition"
          class="tw:mt-4 tw:mb-4"
        >
          <!-- Dark styling is bound to the app theme (store.state.theme), NOT
               tw:dark: — the tw:dark: variant follows the OS prefers-color-scheme
               here (no @custom-variant dark), which flips this card dark in the
               app's light mode. -->
          <OCard
            class="function-definition-card tw:border tw:rounded-lg tw:overflow-hidden"
            :class="isDark
              ? 'tw:border-[#2d3748] tw:bg-[#1a202c] tw:shadow-[0_4px_12px_rgba(0,0,0,0.4)]'
              : 'tw:border-[#e1e5e9] tw:shadow-[0_2px_4px_rgba(0,0,0,0.05)]'"
          >
            <OCardSection
              role="header"
              class="tw:border-b"
              :class="isDark
                ? 'tw:bg-[linear-gradient(135deg,#2d3748_0%,#1a202c_100%)] tw:border-b-[#4a5568]'
                : 'tw:bg-[linear-gradient(135deg,#f8fafc_0%,#f1f5f9_100%)] tw:border-b-[#e2e8f0]'"
            >
              <div
                class="tw:text-base tw:font-semibold"
                :class="isDark ? 'tw:text-white' : 'tw:text-[#2d3748]'"
              >
                {{ t("function.function_definition") }}
              </div>
            </OCardSection>
            <OSeparator />
            <OCardSection class="tw:p-0">
              <div
                class="function-code-container tw:max-h-[250px] tw:overflow-y-auto tw:relative"
                :class="isDark ? 'tw:bg-[#0d1117] tw:border tw:border-[#21262d]' : 'tw:bg-[#fafbfc]'"
              >
                <pre
                  class="function-code tw:bg-transparent tw:m-0 tw:p-4 tw:text-[13px] tw:leading-normal tw:whitespace-pre-wrap tw:break-words tw:border-0 tw:font-normal tw:cursor-default tw:select-text"
                  :class="isDark ? 'tw:text-[#f7fafc]' : 'tw:text-[#2d3748]'"
                >{{ selectedDefinition }}</pre>
              </div>
            </OCardSection>
          </OCard>
        </div>

        <!-- After-Flattening (RAF/RBF) toggle + guidelines -->
        <div v-if="showFlatten" class="tw:w-full tw:flex tw:flex-col tw:gap-3">
          <OSwitch
            v-model="afterFlatten"
            :label="t('flow.function.flatten')"
            data-test="function-picker-after-flatten-toggle"
          />
          <div class="tw:bg-[#f9f290] tw:text-[#2d3748] tw:w-full tw:rounded-md tw:p-3 tw:flex tw:flex-col tw:gap-2">
            <div class="tw:text-sm tw:text-[#2d3748]">
              {{ t("flow.function.guidelinesTitle") }}
            </div>
            <div class="tw:flex tw:flex-col tw:gap-1 tw:text-sm tw:text-[#2d3748]">
              <div class="tw:flex tw:items-start tw:gap-2">
                <OIcon name="info" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500" />
                <span>
                  <span class="tw:font-bold tw:text-[#007bff]">{{ t("flow.function.rbf") }}</span>
                  {{ t("flow.function.rbfDesc") }}
                </span>
              </div>
              <div class="tw:flex tw:items-start tw:gap-2">
                <OIcon name="info" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500" />
                <span>
                  <span class="tw:font-bold tw:text-[#007bff]">{{ t("flow.function.raf") }}</span>
                  {{ t("flow.function.rafDesc") }}
                </span>
              </div>
            </div>
          </div>
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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import functionsService from "@/services/jstransform";

const AddFunction = defineAsyncComponent(
  () => import("@/components/functions/AddFunction.vue"),
);

const props = withDefaults(
  defineProps<{
    initialName?: string;
    initialAfterFlatten?: boolean;
    showFlatten?: boolean;
    isUpdating?: boolean;
    duplicateNames?: string[];
    // Sample events to seed the inline function editor's "Events" panel (e.g. the
    // workflow alert payload). Omitted → the generic log sample.
    sampleEvents?: any[];
  }>(),
  {
    initialName: "",
    initialAfterFlatten: true,
    showFlatten: true,
    isUpdating: false,
    duplicateNames: () => [],
    sampleEvents: undefined,
  },
);

const emit = defineEmits<{
  (e: "expand", value: boolean): void;
  (e: "created", fn: any): void;
}>();

const { t } = useI18n();
const store = useStore();

// App theme (not tw:dark:, which follows the OS here — see the preview markup).
const isDark = computed(() => store.state.theme === "dark");

const loading = ref(false);
const functionOptions = ref<string[]>([]);
const functionDefs = ref<Record<string, string>>({});

const selectedFunction = ref<string>(props.initialName || "");
const afterFlatten = ref<boolean>(props.initialAfterFlatten);
const showRequiredError = ref(false);
const createNewFunction = ref(false);
const addFunctionRef = ref<any>(null);

watch(createNewFunction, (v) => emit("expand", v));
watch(selectedFunction, (v) => {
  if (v) showRequiredError.value = false;
});

const selectedDefinition = computed(
  () => functionDefs.value[selectedFunction.value] || "",
);
const functionExists = computed(
  () =>
    !props.isUpdating &&
    !!selectedFunction.value &&
    props.duplicateNames.includes(selectedFunction.value),
);

// Load saved VRL functions (skip JS functions, trans_type === 1).
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
    toast({ variant: "error", message: t("flow.function.loadError") });
  } finally {
    loading.value = false;
  }
};

onMounted(getFunctions);

const onFunctionCreation = async (fn: any) => {
  createNewFunction.value = false;
  emit("created", fn);
  await getFunctions();
  await nextTick();
  if (fn?.name) selectedFunction.value = fn.name;
};

// Inline editor back/cancel: return to the picker (don't close the host drawer).
const cancelFunctionCreation = () => {
  createNewFunction.value = false;
};

// Read the current selection as a node payload, or null if invalid.
const getPayload = () => {
  if (createNewFunction.value) return null;
  if (!selectedFunction.value) {
    showRequiredError.value = true;
    return null;
  }
  if (functionExists.value) return null;
  return props.showFlatten
    ? { name: selectedFunction.value, after_flatten: afterFlatten.value }
    : { name: selectedFunction.value };
};

defineExpose({ getPayload });
</script>

<style scoped>
/* Hide AddFunction's own title/back/fullscreen chrome inside the drawer. */
.flow-add-function :deep(.add-function-back-btn),
.flow-add-function :deep(.add-function-fullscreen-btn),
.flow-add-function :deep(.add-function-title) {
  display: none;
}
.flow-add-function :deep(.add-function-name-input) {
  width: 100%;
  margin-left: 0 !important;
}

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
