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
  <!-- ── FORM MODE (opt-in via `name-prefix` inside a parent <OForm>) ────────
       Rows are FORM-OWNED: rendered as OFormInput fields with indexed names
       (`${namePrefix}[i].key/value`), added/removed through the injected form
       (pushFieldValue/removeFieldValue). No v-model, no local mirrors — the
       consuming form's schema owns validation (Rule ②). -->
  <div v-if="formMode" class="w-full py-2 variables-input "
  :class="{
    'flex gap-2 items-center w-full': formRows.length == 0,
  }"
  >
    <div class="pb-1 custom-input-label font-bold">
      <span>
        {{ t("alerts.variables.label") }}
      </span>
          <OButton
          variant="ghost-muted"
              size="icon-sm"
            >
              <OIcon name="info-outline" size="sm" />
              <OTooltip :content="t('alerts.advanced.variablesTooltip')" />
          </OButton>
        </div>
    <template v-if="!formRows.length">
      <div class="flex justify-between items-center">

        <OButton
          data-test="alert-variables-add-btn"
          size="sm"
          variant="outline"
          @click="addFormRow"
        >
        <OIcon name="add" size="sm" />
        <span>{{ t("alerts.advanced.addVariable") }}</span>
      </OButton>
      </div>
    </template>
    <template v-else>
      <!-- 🔑 :key MUST be the array INDEX (Rule ①): the fields bind by
           index-based `name` and form.Field resolves its name at CREATION, so
           a stable-id key would leave surviving rows bound to their OLD index
           after a mid-list delete (inputs shifted/blank). -->
      <div
        v-for="(row, index) in formRows"
        :key="index"
        class="gap-2 pb-2 flex items-center"
        :data-test="`alert-variables-${index + 1}`"
      >
        <div class="ml-0">
          <OFormInput
            data-test="alert-variables-key-input"
            :name="`${namePrefix}[${index}].key`"
            :placeholder="t('common.name')"
            tabindex="0"
          />
        </div>
        <div class="ml-0">
          <OFormInput
            data-test="alert-variables-value-input"
            :name="`${namePrefix}[${index}].value`"
            :placeholder="t('common.value')"
            tabindex="0"
            style="min-width: 250px"
          />
        </div>
        <div class="w-1/6 ml-0">
          <OButton
            data-test="alert-variables-delete-variable-btn"
            class="ml-1"
            variant="ghost"
            size="icon-circle-sm"
            :title="t('alert_templates.edit')"
            @click="removeFormRow(index)"
          >
            <OIcon name="delete" size="sm" />
          </OButton>
          <OButton
            data-test="alert-variables-add-variable-btn"
            v-if="index === formRows.length - 1"
            class="ml-1"
            variant="ghost"
            size="icon-circle-sm"
            :title="t('alert_templates.edit')"
            @click="addFormRow"
          >
            <OIcon name="add" size="sm" />
          </OButton>
        </div>
      </div>
    </template>
  </div>
  <!-- ── BARE MODE (no name-prefix) — pre-migration behavior, unchanged.
       Consumed bare by pipeline/actionScripts/reports forms; a legitimate
       permanent pattern (see START-HERE 🔀). Do NOT delete. -->
  <div v-else class="w-full py-2 variables-input "
  :class="{
    'flex gap-2 items-center w-full': variables.length == 0,
  }"
  >
    <div class="pb-1 custom-input-label font-bold">
      <span>
        {{ t("alerts.variables.label") }}
      </span>
          <OButton
          variant="ghost-muted"
              size="icon-sm"
            >
              <OIcon name="info-outline" size="sm" />
              <OTooltip :content="t('alerts.advanced.variablesTooltip')" />
          </OButton>
        </div>
    <template v-if="!variables.length">
      <div class="flex justify-between items-center">

        <OButton
          data-test="alert-variables-add-btn"
          size="sm"
          variant="outline"
          @click="addVariable"
        >
        <OIcon name="add" size="sm" />
        <span>{{ t("alerts.advanced.addVariable") }}</span>
      </OButton>
      </div>
    </template>
    <template v-else>
      <div
        v-for="(variable, index) in variables as any"
        :key="variable.uuid"
        class="gap-2 pb-2 flex items-center"
        :data-test="`alert-variables-${index + 1}`"
      >
        <div class="ml-0">
          <OInput
            data-test="alert-variables-key-input"
            v-model="variable.key"
            :placeholder="t('common.name')"
            tabindex="0"
          />
        </div>
        <div class="ml-0">
          <OInput
            data-test="alert-variables-value-input"
            v-model="variable.value"
            :placeholder="t('common.value')"
            tabindex="0"
            style="min-width: 250px"
          />
        </div>
        <div class="w-1/6 ml-0">
          <OButton
            data-test="alert-variables-delete-variable-btn"
            class="ml-1"
            variant="ghost"
            size="icon-circle-sm"
            :title="t('alert_templates.edit')"
            @click="removeVariable(variable)"
          >
            <OIcon name="delete" size="sm" />
          </OButton>
          <OButton
            data-test="alert-variables-add-variable-btn"
            v-if="index === variables.length - 1"
            class="ml-1"
            variant="ghost"
            size="icon-circle-sm"
            :title="t('alert_templates.edit')"
            @click="addVariable"
          >
            <OIcon name="add" size="sm" />
          </OButton>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";

const props = defineProps({
  variables: {
    type: Array,
    required: false,
    default: () => [],
  },
  /**
   * OForm "form mode" opt-in: the path of the rows array inside the parent
   * <OForm>'s values (e.g. "variables" / "context_attributes"). When set AND a
   * form context is injectable, rows render as OFormInput fields with indexed
   * names (`${namePrefix}[i].key|value`). Without it the component behaves
   * exactly as before (bare mode).
   */
  namePrefix: {
    type: String,
    default: "",
    required: false,
  },
});

const emits = defineEmits(["add:variable", "remove:variable"]);

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

const makeVariableRow = () => ({ key: "", value: "" });

const addFormRow = () =>
  injectedForm?.pushFieldValue(props.namePrefix, makeVariableRow());

const removeFormRow = (index: number) =>
  injectedForm?.removeFieldValue(props.namePrefix, index);

// ── Bare mode handlers (unchanged) ──────────────────────────────────────────

const removeVariable = (variable: any) => {
  emits("remove:variable", variable);
};

const addVariable = () => {
  emits("add:variable");
};
</script>
