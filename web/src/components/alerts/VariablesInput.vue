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
  <div class="tw:w-full tw:py-2 variables-input "
  :class="{
    'tw:flex tw:gap-2 tw:items-center tw:w-full': variables.length == 0,
  }"
  >
    <div class="tw:pb-1 custom-input-label tw:font-bold">
      <span>
        Variable
      </span>
          <OButton
          variant="ghost-muted"
              size="icon-sm"
            >
              <OIcon name="info-outline" size="sm" />
              <OTooltip content="Variables are used to pass data from the alert to the destination." />
          </OButton>
        </div>
    <template v-if="!variables.length">
      <div class="tw:flex tw:justify-between tw:items-center">

        <OButton
          data-test="alert-variables-add-btn"
          size="sm"
          variant="outline"
          @click="addVariable"
        >
        <OIcon name="add" size="sm" />
        <span>Add Variable</span>
      </OButton>
      </div>
    </template>
    <template v-else>
      <div
        v-for="(variable, index) in variables as any"
        :key="variable.uuid"
        class="tw:gap-2 tw:pb-2 tw:flex tw:items-center"
        :data-test="`alert-variables-${index + 1}`"
      >
        <div class="tw:ml-0">
          <OInput
            data-test="alert-variables-key-input"
            v-model="variable.key"
            :placeholder="t('common.name')"
            tabindex="0"
          />
        </div>
        <div class="tw:ml-0">
          <OInput
            data-test="alert-variables-value-input"
            v-model="variable.value"
            :placeholder="t('common.value')"
            tabindex="0"
            style="min-width: 250px"
          />
        </div>
        <div class="tw:w-1/6 tw:ml-0">
          <OButton
            data-test="alert-variables-delete-variable-btn"
            class="tw:ml-1"
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
            class="tw:ml-1"
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
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

const props = defineProps({
  variables: {
    type: Array,
    required: true,
  },
});

const emits = defineEmits(["add:variable", "remove:variable"]);

const store = useStore();

const { t } = useI18n();

const removeVariable = (variable: any) => {
  emits("remove:variable", variable);
};

const addVariable = () => {
  emits("add:variable");
};
</script>

<style lang="scss">
.add-variable {
}

.variables-input {
}

.input-bg-dark .q-field__control{
  background-color: #181a1b !important;
}
.input-bg-light .q-field__control{
  background-color: #ffffff !important;
}
</style>
