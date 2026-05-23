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
    <div data-test="alert-conditions-text" class="tw:font-bold">
      Conditions * (AND operator is used by default to evaluate multiple
      conditions)
    </div>
    <template v-if="!fields.length">
      <OButton
        data-test="alert-conditions-add-btn"
        variant="outline"
        size="sm"
        class="tw:mt-2"
        @click="addApiHeader"
        icon-left="add"
      >
        Add Condition
      </OButton>
    </template>
    <template v-else>
      <div
        v-for="(field, index) in fields as any"
        :key="field.uuid"
        class="tw:flex tw:justify-start tw:items-end tw:gap-2 tw:pb-2"
        :data-test="`alert-conditions-${index + 1}`"
      >
        <div class="tw:ml-0 o2-input">
          <OSelect
            v-model="field.column"
            :options="props.streamFields"
            class="tw:py-2"
            :placeholder="t('alerts.column')"
            :creatable="props.enableNewValueMode"
            :error="!!fieldErrors[`${field.uuid}-column`]"
            :error-message="fieldErrors[`${field.uuid}-column`] || ''"
            style="min-width: 220px"
            data-test="alert-conditions-select-column"
            @create="(val: string) => { field.column = val; emits('input:update', 'conditions', field); }"
            @update:model-value="(v: any) => { fieldErrors[`${field.uuid}-column`] = v ? '' : 'Field is required!'; emits('input:update', 'conditions', field); }"
          />
        </div>
        <div class="tw:ml-0 o2-input">
          <OSelect
            v-model="field.operator"
            :options="triggerOperators"
            class="tw:py-2"
            :error="!!fieldErrors[`${field.uuid}-operator`]"
            :error-message="fieldErrors[`${field.uuid}-operator`] || ''"
            style="min-width: 120px"
            data-test="alert-conditions-operator-select"
            @update:model-value="(v: any) => { fieldErrors[`${field.uuid}-operator`] = v ? '' : 'Field is required!'; emits('input:update', 'conditions', field); }"
          />
        </div>
        <div class="tw:ml-0 tw:flex tw:items-end o2-input">
          <OInput
            v-model="field.value"
            :placeholder="t('common.value')"
            class="tw:py-2"
            :error="!!fieldErrors[`${field.uuid}-value`]"
            :error-message="fieldErrors[`${field.uuid}-value`] || ''"
            style="min-width: 150px"
            data-test="alert-conditions-value-input"
            @update:model-value="(v: any) => { fieldErrors[`${field.uuid}-value`] = v ? '' : 'Field is required!'; emits('input:update', 'conditions', field); }"
          />
        </div>
        <div
          class="tw:ml-0 alerts-condition-action"
          style="margin-bottom: 12px"
        >
          <OButton
            data-test="alert-conditions-delete-condition-btn"
            class="tw:ml-1"
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
            class="tw:ml-1"
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
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, reactive } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { useStore } from "vuex";

const props = defineProps({
  fields: {
    type: Array,
    default: () => [],
    required: true,
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
    }
  
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

const deleteApiHeader = (field: any) => {
  emits("remove", field);
  emits("input:update", "conditions", field);
};

const addApiHeader = () => {
  emits("add");
};



</script>

<style lang="scss">
.add-field {
}

.alerts-condition-action {
}
</style>
