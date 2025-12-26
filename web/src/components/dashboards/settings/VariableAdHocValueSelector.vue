<template>
    <div class="row items-center">
        <!-- <div class="q-mb-sm title" :class="store.state.theme === 'dark' ? 'bg-grey-8' : 'bg-grey-4'" no-caps no-outline rounded>{{ variableItem?.name }}</div> -->
        <div class="row no-wrap items-center q-mb-xs" v-for="(item, index) in adhocVariables" :key="index">
            <q-input
                dense
                v-model="adhocVariables[index].name"
                debounce="1000"
                data-test="dashboard-variable-adhoc-name-selector"
                placeholder="Enter Name"
                @update:model-value="updateModelValueOfSelect(index, $event)"
                class="textbox col no-case q-ml-sm"
             borderless hide-bottom-space>
            </q-input>
            <q-select dense v-model="adhocVariables[index].operator"
                :display-value="adhocVariables[index].operator ? adhocVariables[index].operator : ''"
                :options="operatorOptions" style="width: auto" class="operator" data-test="dashboard-variable-adhoc-operator-selector"  borderless hide-bottom-space/>
            <q-input v-model="adhocVariables[index].value" placeholder="Enter Value" dense debounce="1000" style="width: 125px" class="" data-test="dashboard-variable-adhoc-value-selector"  borderless hide-bottom-space/>
            <q-btn class="close tw:ml-1" size="xs" :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-grey-3'" padding="8px 2px" square flat dense @click="removeField(index)" icon="close" :data-test="`dashboard-variable-adhoc-close-${index}`"/>
            <!-- <div v-if="index != adhocVariables.length - 1" class="q-ml-sm and-border" :class="store.state.theme === 'dark' ? 'bg-grey-8' : 'bg-grey-4'">AND</div> -->
        </div>
        <q-btn class="text-bold no-border q-ml-xs q-mb-sm hideOnPrintMode" no-caps no-outline rounded padding="xs" @click="addFields" data-test="dashboard-variable-adhoc-add-selector" >
            <DynamicFilterIcon />
            <q-tooltip>Add Dynamic Filter</q-tooltip>
        </q-btn>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, toRef, watch, type Ref, toRefs } from 'vue';
import { useSelectAutoComplete } from '../../../composables/useSelectAutocomplete';
import { useStore } from "vuex";
import DynamicFilterIcon from "../../icons/DynamicFilterIcon.vue";

export default defineComponent({
    name: 'VariableAdHocValueSelector',
    props: ['modelValue', 'variableItem'],
    emits: ['update:modelValue'],
    components: { DynamicFilterIcon },
    
    setup(props: any, { emit }) {
        const store = useStore();
        const operatorOptions = ['=', '!='];
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
            adhocVariables.value[index].name = value              
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
.printMode {
  .hideOnPrintMode {
    display: none;
  }
}
</style>
