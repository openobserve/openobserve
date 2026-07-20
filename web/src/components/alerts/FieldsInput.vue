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

<template>
  <div>
    <!-- ── FORM MODE (opt-in via `name-prefix` inside a parent <OForm>) ──────
         Rows are FORM-OWNED: rendered as OForm* fields with indexed names
         (`${namePrefix}[i].column/operator/value`), added/removed through the
         injected form (pushFieldValue/removeFieldValue). No v-model, no manual
         error refs — the consuming form's schema owns validation (Rule ②). -->
    <template v-if="formMode">
      <div data-test="alert-conditions-text" class="font-bold">
        {{ t('alerts.filters.conditions') + ' *' }} {{ t('alerts.filters.conditionsHint') }}
      </div>
      <template v-if="!formRows.length">
        <OButton
          data-test="alert-conditions-add-btn"
          variant="outline"
          size="sm"
          class="mt-2"
          @click="addFormRow"
          icon-left="add"
        >
          {{ t('alerts.addCondition') }}
        </OButton>
      </template>
      <template v-else>
        <!-- 🔑 :key MUST be the array INDEX (Rule ①): the fields bind by
             index-based `name` and form.Field resolves its name at CREATION,
             so a stable-id key would leave surviving rows bound to their OLD
             index after a mid-list delete (inputs shifted/blank). -->
        <div
          v-for="(row, index) in formRows"
          :key="index"
          class="flex justify-start items-end gap-2 pb-2"
          :data-test="`alert-conditions-${index + 1}`"
        >
          <div class="ml-0 o2-input">
            <OFormSelect
              :name="`${namePrefix}[${index}].column`"
              :options="props.streamFields"
              class="py-2"
              :placeholder="t('alerts.column')"
              :creatable="props.enableNewValueMode"
              style="min-width: 220px"
              data-test="alert-conditions-select-column"
              @create="(val: string) => setRowColumn(index, val)"
            />
          </div>
          <div class="ml-0 o2-input">
            <OFormSelect
              :name="`${namePrefix}[${index}].operator`"
              :options="triggerOperators"
              class="py-2"
              style="min-width: 120px"
              data-test="alert-conditions-operator-select"
            />
          </div>
          <div class="ml-0 flex items-end o2-input">
            <OFormInput
              :name="`${namePrefix}[${index}].value`"
              :placeholder="t('common.value')"
              class="py-2"
              style="min-width: 150px"
              data-test="alert-conditions-value-input"
            />
          </div>
          <div
            class="ml-0 alerts-condition-action"
            style="margin-bottom: 12px"
          >
            <OButton
              data-test="alert-conditions-delete-condition-btn"
              class="ml-1"
              variant="ghost"
              size="icon-circle-sm"
              :title="t('alert_templates.edit')"
              @click="removeFormRow(index)"
            >
              <OIcon name="delete" size="sm" />
            </OButton>
            <OButton
              data-test="alert-conditions-add-condition-btn"
              v-if="index === formRows.length - 1"
              class="ml-1"
              variant="ghost"
              size="icon-circle-sm"
              :title="t('alert_templates.edit')"
              @click="addFormRow()"
            >
              <OIcon name="add" size="sm" />
            </OButton>
          </div>
        </div>
      </template>
    </template>
    <!-- ── BARE MODE (no name-prefix) — pre-migration behavior, unchanged.
         Consumed bare by functions/logstream/pipeline forms; a legitimate
         permanent pattern (see START-HERE 🔀). Do NOT delete. -->
    <template v-else>
    <div data-test="alert-conditions-text" class="font-bold">
      {{ t('alerts.filters.conditions') + ' *' }} {{ t('alerts.filters.conditionsHint') }}
    </div>
    <template v-if="!fields.length">
      <OButton
        data-test="alert-conditions-add-btn"
        variant="outline"
        size="sm"
        class="mt-2"
        @click="addApiHeader"
        icon-left="add"
      >
        {{ t('alerts.addCondition') }}
      </OButton>
    </template>
    <template v-else>
      <div
        v-for="(field, index) in fields as any"
        :key="field.uuid"
        class="flex justify-start items-end gap-2 pb-2"
        :data-test="`alert-conditions-${index + 1}`"
      >
        <div class="ml-0 o2-input">
          <OSelect
            v-model="field.column"
            :options="props.streamFields"
            class="py-2"
            :placeholder="t('alerts.column')"
            :creatable="props.enableNewValueMode"
            :error="!!fieldErrors[`${field.uuid}-column`]"
            :error-message="fieldErrors[`${field.uuid}-column`] || ''"
            style="min-width: 220px"
            data-test="alert-conditions-select-column"
            @create="(val: string) => { field.column = val; emits('input:update', 'conditions', field); }"
            @update:model-value="(v: any) => { fieldErrors[`${field.uuid}-column`] = v ? '' : t('alerts.validation.fieldRequired'); emits('input:update', 'conditions', field); }"
          />
        </div>
        <div class="ml-0 o2-input">
          <OSelect
            v-model="field.operator"
            :options="triggerOperators"
            class="py-2"
            :error="!!fieldErrors[`${field.uuid}-operator`]"
            :error-message="fieldErrors[`${field.uuid}-operator`] || ''"
            style="min-width: 120px"
            data-test="alert-conditions-operator-select"
            @update:model-value="(v: any) => { fieldErrors[`${field.uuid}-operator`] = v ? '' : t('alerts.validation.fieldRequired'); emits('input:update', 'conditions', field); }"
          />
        </div>
        <div class="ml-0 flex items-end o2-input">
          <OInput
            v-model="field.value"
            :placeholder="t('common.value')"
            class="py-2"
            :error="!!fieldErrors[`${field.uuid}-value`]"
            :error-message="fieldErrors[`${field.uuid}-value`] || ''"
            style="min-width: 150px"
            data-test="alert-conditions-value-input"
            @update:model-value="(v: any) => { fieldErrors[`${field.uuid}-value`] = v ? '' : t('alerts.validation.fieldRequired'); emits('input:update', 'conditions', field); }"
          />
        </div>
        <div
          class="ml-0 alerts-condition-action"
          style="margin-bottom: 12px"
        >
          <OButton
            data-test="alert-conditions-delete-condition-btn"
            class="ml-1"
            variant="ghost"
            size="icon-circle-sm"
            :title="t('alert_templates.edit')"
            @click="deleteApiHeader(field)"
          >
            <OIcon name="delete" size="sm" />
          </OButton>
          <OButton
            data-test="alert-conditions-add-condition-btn"
            v-if="index === fields.length - 1"
            class="ml-1"
            variant="ghost"
            size="icon-circle-sm"
            :title="t('alert_templates.edit')"
            @click="addApiHeader()"
          >
            <OIcon name="add" size="sm" />
          </OButton>
        </div>
      </div>
    </template>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, reactive, inject } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { useStore } from "vuex";

const props = defineProps({
  fields: {
    type: Array,
    default: () => [],
    required: false,
  },
  streamFields: {
    type: Array,
    default: () => [],
    required: true,
  },
  enableNewValueMode: {
      type: Boolean,
      default: false,
      required: false,
    },
  /**
   * OForm "form mode" opt-in: the path of the rows array inside the parent
   * <OForm>'s values (e.g. "conditions" / "query_condition.conditions").
   * When set AND a form context is injectable, rows render as OForm* fields
   * with indexed names (`${namePrefix}[i].column|operator|value`). Without it
   * the component behaves exactly as before (bare mode).
   */
  namePrefix: {
    type: String,
    default: "",
    required: false,
  },
});
const fieldErrors = reactive<Record<string, string>>({});

var triggerOperators: any = ref([
  "=",
  "!=",
  ">=",
  "<=",
  ">",
  "<",
  "Contains",
  "NotContains",
]);
const emits = defineEmits(["add", "remove", "input:update"]);

const store = useStore();

const { t } = useI18n();

// ── OForm form mode (dual-mode; opt-in via namePrefix) ──────────────────────
// A consumer inside an <OForm> may inject a form context even when it renders
// this component bare (e.g. pipeline's Condition.vue bridge) — form mode
// therefore requires BOTH the injected form AND an explicit namePrefix.
const injectedForm = inject(FORM_CONTEXT_KEY, null);
const formMode = computed(() => !!(props.namePrefix && injectedForm));

/** Resolve a dotted/indexed path ("a.b[2].c") inside the form values. */
const resolvePath = (obj: any, path: string): any =>
  path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce((acc: any, key: string) => (acc == null ? undefined : acc[key]), obj);

// ⚠️ MUST be form.useStore (reactive) — NOT form.state.values (a snapshot a
// computed won't track; playbook §2).
const formRows = injectedForm
  ? injectedForm.useStore((s: any) =>
      props.namePrefix ? (resolvePath(s.values, props.namePrefix) ?? []) : [],
    )
  : ref<any[]>([]);

const makeConditionRow = () => ({ column: "", operator: "=", value: "" });

const addFormRow = () =>
  injectedForm?.pushFieldValue(props.namePrefix, makeConditionRow());

const removeFormRow = (index: number) =>
  injectedForm?.removeFieldValue(props.namePrefix, index);

// A `creatable` OSelect emits only `create` (no update:model-value), so write
// the created value straight into the form field (bare mode's @create parity).
const setRowColumn = (index: number, val: string) =>
  injectedForm?.setFieldValue(`${props.namePrefix}[${index}].column`, val);

// ── Bare mode handlers (unchanged) ──────────────────────────────────────────

const deleteApiHeader = (field: any) => {
  emits("remove", field);
  emits("input:update", "conditions", field);
};

const addApiHeader = () => {
  emits("add");
};



</script>
