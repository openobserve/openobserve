<template>
    <div class="row items-center">
        <div class="q-mb-sm title" :class="store.state.theme === 'dark' ? 'bg-grey-8' : 'bg-grey-4'" no-caps no-outline rounded>{{ variableItem?.name }}</div>
        <div class="row no-wrap items-center q-mb-sm" v-for="(item, index) in adhocVariables" :key="index">
            <q-select filled outlined dense :model-value="adhocVariables[index].name"
                :display-value="adhocVariables[index].name ? adhocVariables[index].name : variableItem.isLoading ? '(No Data Found)' : ''"
                :options="fieldsFilteredOptions" input-debounce="0" behavior="menu" use-input stack-label option-label="name"
                @update:model-value="updateModelValueOfSelect(index, $event)"
                @filter="fieldsFilterFn" :placeholder="adhocVariables[index].name ? '' : 'Select Field'" class="textbox col no-case q-ml-sm" :loading="variableItem.isLoading">
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
            <q-input v-model="adhocVariables[index].value" placeholder="Enter Value" dense filled debounce="1000" style="width: 125px" class="" />
            <q-btn class="close" size="xs" :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-grey-3'" padding="13px 2px" square flat dense @click="removeField(index)" icon="close" />
            <div v-if="index != adhocVariables.length - 1" class="q-ml-sm and-border" :class="store.state.theme === 'dark' ? 'bg-grey-8' : 'bg-grey-4'">AND</div>
        </div>
        <q-btn class="text-bold no-border q-ml-xs q-mb-sm" no-caps no-outline rounded icon="add" padding="xs"
            @click="addFields" />
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, toRef, watch, type Ref, toRefs } from 'vue';
import { useSelectAutoComplete } from '../../../composables/useSelectAutocomplete';
import { useStore } from "vuex";

export default defineComponent({
    name: 'VariableAdHocValueSelector',
    props: ['modelValue', 'variableItem'],
    emits: ['update:modelValue'],
    setup(props: any, { emit }) {
        const store = useStore();
        const operatorOptions = ['=', '!=', '<', '>', '<=', '>='];
        const options = toRef(props.variableItem, 'options');
        const { modelValue: adhocVariables } = toRefs(props)
        const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } = useSelectAutoComplete(options, 'name');

        watch(props.variableItem, () => {

            options.value = props.variableItem?.options;

        });

        const addFields = () => {            
            const adhocVariablesTemp = adhocVariables.value;
            adhocVariablesTemp.push({ name: '', operator: operatorOptions[0], value: '', streams: [] });
            
            emitValue();
        };

        const updateModelValueOfSelect = (index: number, value: any) => {
            adhocVariables.value[index].name = value.name
            adhocVariables.value[index].streams = value.streams
            emitValue()
        }

        const removeField = (index: number) => {
            const adhocVariablesTemp = adhocVariables.value;
            adhocVariablesTemp.splice(index, 1);
            emitValue();
        };

        const emitValue = () => {
            emit('update:modelValue', JSON.parse(JSON.stringify(adhocVariables.value)));
        };

        return {
            fieldsFilterFn,
            fieldsFilteredOptions,
            addFields,
            operatorOptions,
            adhocVariables,
            removeField,
            updateModelValueOfSelect,
            store
        };
    },
});
</script>

<style lang="scss" scoped>
.and-border {
    padding: 4px 6px;
    border-radius: 4px;
    // background-color: $grey-4;
    font-size: smaller;
}

.title {
    padding: 10px 8px;
    border-radius: 4px;
    // background-color: $grey-4;
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
    // background-color: $grey-3;
    border-radius: 0 !important;
}
</style>
