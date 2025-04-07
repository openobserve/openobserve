<template>
  <div class="condition-group">
    <div v-for="(field, index) in fields" :key="field.uuid" class="condition-row">
      <div class="flex justify-start items-center q-col-gutter-sm q-pb-sm" :data-test="`alert-conditions-${index + 1}`">
        <!-- "if" or "AND/OR" Condition -->
        <span v-if="index === 0" class="q-pb-md tw-text-gray-500" style="width: 70px;">if</span>
        <span v-else class="q-pb-md flex items-center justify-center" style="width: 70px;">
          <span>{{ field.condition }}</span>
          <q-btn size="sm" icon="cached" flat dense @click="toggleCondition(field)" />
        </span>

        <!-- Column Selector -->
        <q-select             

        :placeholder="t('alerts.column')"
        v-model="field.column" :options="filteredFields" filled dense style="min-width: 220px" v-if="!field.children" />

        <!-- Operator Selector -->
        <q-select v-model="field.operator" :options="triggerOperators" filled dense style="min-width: 220px" v-if="!field.children" />

        <!-- Value Input -->
        <q-input v-model="field.value" filled dense style="min-width: 220px" v-if="!field.children" />

        <!-- Delete Button -->
        <q-btn icon="close" flat size="sm" @click="deleteCondition(field)" />
      </div>

      <!-- Modified Nested Condition Groups -->
      <div v-if="field.children" style="margin-left: 50px; background-color: #2B2B2B; padding: 10px;">
        <FieldsRenderer
          :fields="field.children"
          :depth="depth + 1"
          :parentIndex="index"
          @addConditionGroup="(newDepth, newParentIndex) => $emit('addConditionGroup', newDepth, newParentIndex)"
          @add="(newDepth, newParentIndex) => $emit('add', newDepth, newParentIndex)"
          @input:update="(name, field) => $emit('input:update', name, field)"
          @deleteCondition="$emit('deleteCondition', $event)"
        />
      </div>
    </div>

    <!-- Buttons section -->
    <div class="flex justify-start items-center">
      <q-btn
          v-if="fields.length > 0"
            data-test="alert-conditions-add-condition-btn"
            class="q-ml-xs flex justify-between items-center"
            padding="sm"
            unelevated
            size="sm"
            flat
            :title="'edit'"
            @click="$emit('add', depth, parentIndex)"
            color="primary"
            >
            <q-icon color="primary" class="q-mr-xs text-bold" size="12px" style="border-radius: 50%;  border: 1px solid;" name="add" />
            <span class="text-bold">Condition</span>
        </q-btn>
        <q-btn
          v-if="fields.length > 0"
            data-test="alert-conditions-add-condition-group-btn"
            class="q-ml-xs flex justify-between items-center"
            padding="sm"
            unelevated
            size="sm"
            flat
            @click="$emit('addConditionGroup', depth, parentIndex)"
            color="primary"
            >
            <q-icon color="primary" class="q-mr-xs text-bold" size="12px" style="border-radius: 50%;  border: 1px solid;" name="add" />
            <span class="text-bold">Condition Group</span>
        </q-btn>
     </div>
  </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  fields: {
    type: Array,
    required: true
  },
  depth: {
    type: Number,
    default: 0
  },
  parentIndex: {
    type: Number,
    default: -1
  }
});

const emits = defineEmits(["add", "addConditionGroup", "input:update", "deleteCondition"]);

const {t} = useI18n ();

const toggleCondition = (field) => {
  field.condition = field.condition === 'AND' ? 'OR' : 'AND';
};

const deleteCondition = (field) => {
  emits("deleteCondition", field);
};
</script>

<style scoped>
.condition-group {
  margin-bottom: 12px;
}
</style>
