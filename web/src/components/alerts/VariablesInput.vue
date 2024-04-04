<template>
  <div class="col-12 q-py-sm variables-input">
    <template v-if="!variables.length">
      <q-btn
        data-test="alert-variables-add-btn"
        label="Add Variable"
        size="sm"
        class="text-bold add-variable"
        icon="add"
        style="
          border-radius: 4px;
          text-transform: capitalize;
          background: #f2f2f2 !important;
          color: #000 !important;
        "
        @click="addVariable"
      />
    </template>
    <template v-else>
      <div
        v-for="(variable, index) in (variables as any)"
        :key="variable.uuid"
        class="q-col-gutter-sm q-pb-sm flex items-center"
        :data-test="`alert-variables-${index + 1}`"
      >
        <div class="q-ml-none">
          <q-input
            data-test="alert-variables-key-input"
            v-model="variable.key"
            color="input-border"
            bg-color="input-bg"
            stack-label
            outlined
            filled
            :placeholder="t('common.name')"
            dense
            tabindex="0"
            style="min-width: 250px"
          />
        </div>
        <div class="q-ml-none">
          <q-input
            data-test="alert-variables-value-input"
            v-model="variable.value"
            :placeholder="t('common.value')"
            color="input-border"
            bg-color="input-bg"
            stack-label
            outlined
            filled
            dense
            isUpdatingDestination
            tabindex="0"
            style="min-width: 250px"
          />
        </div>
        <div class="col-2 q-ml-none">
          <q-btn
            data-test="alert-variables-delete-variable-btn"
            :icon="outlinedDelete"
            class="q-ml-xs iconHoverBtn"
            :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
            padding="sm"
            unelevated
            size="sm"
            round
            flat
            :title="t('alert_templates.edit')"
            @click="removeVariable(variable)"
          />
          <q-btn
            data-test="alert-variables-add-variable-btn"
            v-if="index === variables.length - 1"
            icon="add"
            class="q-ml-xs iconHoverBtn"
            :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
            padding="sm"
            unelevated
            size="sm"
            round
            flat
            :title="t('alert_templates.edit')"
            @click="addVariable"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { defineProps } from "vue";
import { useI18n } from "vue-i18n";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import { useStore } from "vuex";

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
  .q-icon {
    margin-right: 4px !important;
    font-size: 15px !important;
  }
}

.variables-input {
  .q-btn {
    &.icon-dark {
      filter: none !important;
    }
  }
}
</style>
