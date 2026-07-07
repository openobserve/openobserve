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
  <div class="w-full py-2 variables-input "
  :class="{
    'flex gap-2 items-center w-full': variables.length == 0,
  }"
  >
    <div class="pb-1 custom-input-label font-bold">
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
      <div class="flex justify-between items-center">

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
