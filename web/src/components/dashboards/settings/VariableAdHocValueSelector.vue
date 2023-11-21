<template>
    <div class="row no-wrap items-center">
        <q-btn class="text-bold no-border bg-grey-3" no-caps no-outline rounded :label="variableItem?.name" />
        <div class="row no-wrap items-center" v-if="isSelectVisible">
        <q-select style="width: auto" filled outlined dense v-model="selectedField"
            :display-value="selectedField ? selectedField : !variableItem.isLoading ? '(No Data Found)' : ''"
            :options="fieldsFilteredOptions" input-debounce="0" behavior="menu" use-input stack-label
            @filter="fieldsFilterFn" class="textbox col no-case q-ml-sm"
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
          style="width: auto"
          class="q-ml-sm"
        />
        <q-input
          v-model="inputValue"
          dense
          filled 
          :input-debounce="1000"
          style="width: auto"
          class="q-ml-sm"
        />
        </div>
        <q-btn class="text-bold no-border q-ml-xs" no-caps no-outline rounded icon="add" padding="xs" @click="addFields" />
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

        const selectedField = ref(String(props.variableItem?.value?.name));
        const operatorOptions = ['=', '!=', '<', '>', '<=', '>=']; 
        const selectedOperator = ref(operatorOptions[0]);
        const options = toRef(props.variableItem, 'options');
        const isSelectVisible = ref(false);
        const inputValue = ref('');
        const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } = useSelectAutoComplete(options, 'name');

        watch( props.variableItem, () => {
            console.log("props.variableItem", props.variableItem.value);
            
            options.value = props.variableItem?.options;
            
        });

        const addFields = () => {
            if (!isSelectVisible.value) {
                console.log('Setting isSelectVisible to true');
                isSelectVisible.value = true;
            }
        };
        
        console.log("VariableAdHocValueSelector::--", selectedField.value, selectedOperator.value, inputValue.value);
        watch([selectedField, selectedOperator, inputValue], () => {
            // Emit both selected value and selected operator
            console.log("VariableAdHocValueSelector::", selectedField.value, selectedOperator.value, inputValue.value);
            emit('update:modelValue', { name: selectedField.value, operator: selectedOperator.value, value: inputValue.value });
        });

        return {
            selectedField,
            fieldsFilterFn,
            fieldsFilteredOptions,
            isSelectVisible,
            addFields,
            operatorOptions,
            selectedOperator,
            inputValue
        };
    },
});
</script>

<style lang="scss" scoped></style>
