<template>
    <div class="row items-center">
        <div class="q-mb-sm title" no-caps no-outline rounded>{{ variableItem?.name }}</div>
        <div class="row no-wrap items-center q-mb-sm" v-for="(item, index) in adhocVariables" :key="index">
            <q-select filled outlined dense v-model="adhocVariables[index].name"
                :display-value="adhocVariables[index].name ? adhocVariables[index].name : !variableItem.isLoading ? '(No Data Found)' : ''"
                :options="fieldsFilteredOptions" input-debounce="0" behavior="menu" use-input stack-label
                @filter="fieldsFilterFn" class="textbox col no-case q-ml-sm" :loading="variableItem.isLoading">
                <template v-slot:no-option>
                    <q-item>
                        <q-item-section class="text-italic text-grey">
                            No Data Found
                        </q-item-section>
                    </q-item>
                </template>
            </q-select>
            <q-select dense filled v-model="adhocVariables[index].operator"
                :display-value="adhocVariables[index].operator ? adhocVariables[index].operator : ''"
                :options="operatorOptions" style="width: auto" class="operator" />
            <q-input v-model="adhocVariables[index].value" dense filled debounce="1000" style="width: 125px" class="" />
            <q-btn class="close" size="xs" padding="13px 2px" square flat dense @click="removeField(index)" icon="close" />
            <div v-if="index != adhocVariables.length - 1" class="q-ml-sm and-border">AND</div>
        </div>
        <q-btn class="text-bold no-border q-ml-xs q-mb-sm" no-caps no-outline rounded icon="add" padding="xs"
            @click="addFields" />
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, toRef, watch, type Ref, toRefs } from 'vue';
import { useSelectAutoComplete } from '../../../composables/useSelectAutocomplete';
import { cloneDeep } from 'lodash-es';

export default defineComponent({
    name: 'VariableAdHocValueSelector',
    props: ['modelValue', 'variableItem'],
    emits: ['update:modelValue'],
    setup(props: any, { emit }) {
        console.log('VariableAdHocValueSelector');

        // const selectedField = ref(String(props.variableItem?.value?.name));
        const operatorOptions = ['=', '!=', '<', '>', '<=', '>='];
        // const selectedOperator = ref(operatorOptions[0]);
        const options = toRef(props.variableItem, 'options');
        // const isSelectVisible = ref(false);
        // const inputValue = ref('');
        // const adhocVariables: Ref<Array<any>> = ref([]);
        const { modelValue: adhocVariables } = toRefs(props)
        const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } = useSelectAutoComplete(options, 'name');

        watch(props.variableItem, () => {
            console.log("props.variableItem", props.variableItem.value);

            options.value = props.variableItem?.options;

        });

        const addFields = () => {
            // if (!isSelectVisible.value) {
            //     console.log('Setting isSelectVisible to true');
            //     isSelectVisible.value = true;
            // }
            const adhocVariablesTemp = adhocVariables.value;
            adhocVariablesTemp.push({ name: '', operator: operatorOptions[0], value: '' });
            // adhocVariables.value = cloneDeep(adhocVariablesTemp);

            emitValue()
            // console.log("VariableAdHocValueSelector::()()", selectedField.value, selectedOperator.value, inputValue.value);

        };

        const removeField = (index: number) => {
            const adhocVariablesTemp = adhocVariables.value;
            adhocVariablesTemp.splice(index, 1);
            emitValue();
        };

        const emitValue = () => {
            emit('update:modelValue', cloneDeep(adhocVariables.value));
        };

        // console.log("VariableAdHocValueSelector::--", selectedField.value, selectedOperator.value, inputValue.value);
        // watch([selectedField, selectedOperator, inputValue], () => {
        //     // Emit both selected value and selected operator
        //     adhocVariables.value = [
        //         { name: selectedField.value, operator: selectedOperator.value, value: inputValue.value }
        //     ];
        //     console.log("VariableAdHocValueSelector::==", adhocVariables.value);
        //     console.log("VariableAdHocValueSelector::", selectedField.value, selectedOperator.value, inputValue.value);
        //     emit('update:modelValue', adhocVariables.value);
        // });

        return {
            // selectedField,
            fieldsFilterFn,
            fieldsFilteredOptions,
            // isSelectVisible,
            addFields,
            operatorOptions,
            adhocVariables,
            removeField
            // selectedOperator,
            // inputValue
        };
    },
});
</script>

<style lang="scss" scoped>
.and-border {
    padding: 4px 6px;
    border-radius: 4px;
    background-color: $grey-4;
    font-size: smaller;
}

.title {
    padding: 10px 8px;
    border-radius: 4px;
    background-color: $grey-4;
    font-size: small;
    font-weight: bold;
}

.operator {
    border-left: 1px solid $grey-4;
    border-right: 1px solid $grey-4;
}

.close {
    height: 100%;
    // border-top: 1px solid $grey-4;
    border-left: 1px solid $grey-4;
    // border-bottom: 1px solid $grey-4;
    background-color: $grey-3;
    border-radius: 0 !important;
}
</style>
