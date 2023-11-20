<template>
    <div>
        <q-btn class="text-bold no-border bg-grey-3" no-caps no-outline rounded :label="variableItem?.name" />
        <q-btn class="text-bold no-border q-ml-xs" no-caps no-outline rounded icon="add" padding="xs" @click="addFields" />
        <q-select style="min-width: 150px;" filled outlined dense v-model="selectedValue"
            :display-value="selectedValue ? selectedValue : !variableItem.isLoading ? '(No Data Found)' : ''"
            :options="fieldsFilteredOptions" input-debounce="0" behavior="menu" use-input stack-label
            @filter="fieldsFilterFn" option-value="name" option-label="name" emit-value class="textbox col no-case"
            :loading="variableItem.isLoading">
            <template v-slot:no-option>
                <q-item>
                    <q-item-section class="text-italic text-grey">
                        No Data Found
                    </q-item-section>
                </q-item>
            </template>
        </q-select>
        <q-select
          dense
          filled
          v-model="selectedOperator"
          :display-value="selectedOperator ? selectedOperator : ''"
          :options="operatorOptions"
          label="Operator"
          style="width: 100%"
        />
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, toRef, watch } from 'vue';
import { useSelectAutoComplete } from '../../../composables/useSelectAutocomplete';

export default defineComponent({
    name: 'VariableAdHocValueSelector',
    props: ['modelValue', 'variableItem'],
    emits: ['update:modelValue'],
    setup(props: any, { emit }) {
        console.log('VariableAdHocValueSelector');

        const selectedValue = ref(String(props.variableItem?.value));
        const operatorOptions = ['=', '<', '>', '<=', '>=']; 
        const selectedOperator = ref(operatorOptions[0]);
        const options = toRef(props.variableItem, 'options');
        const isSelectVisible = ref(false);

        const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } = useSelectAutoComplete(options, 'name');

        watch(() => props.variableItem, () => {
            options.value = props.variableItem?.options;
        });

        const addFields = () => {
            if (!isSelectVisible.value) {
                console.log('Setting isSelectVisible to true');
                isSelectVisible.value = true;
            }
        };

        watch([selectedValue, selectedOperator], () => {
            // Emit both selected value and selected operator
            emit('update:modelValue', { value: selectedValue.value, operator: selectedOperator.value });
        });

        return {
            selectedValue,
            fieldsFilterFn,
            fieldsFilteredOptions,
            isSelectVisible,
            addFields,
            operatorOptions,
            selectedOperator,
        };
    },
});
</script>

<style lang="scss" scoped></style>
