<template>
    <div>
        <q-select style="min-width: 150px;" filled outlined dense v-model="props.variableItem.value" :label="props.variableItem.label || props.variableItem.name"
            :options="fieldsFilteredOptions" input-debounce="0" behavior="menu" use-input
            stack-label @filter="fieldsFilterFn" option-value="name" option-label="name" emit-value class="textbox showLabelOnTop col no-case"
        ></q-select>
    </div>
</template>

<script lang="ts">
import { defineComponent, reactive, toRef } from 'vue';
import { useSelectAutoComplete } from '../../../composables/useSelectAutocomplete';

export default defineComponent({
    name: 'VariableQueryValueSelector',
    props: ["variableItem"],
    setup(props: any, { emit }) {
        console.log("----variableItem-----", props.variableItem);
        const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } = useSelectAutoComplete(toRef(props.variableItem.options, 'options'), 'name')
        
        return {
            props,
            fieldsFilterFn,
            fieldsFilteredOptions
        }
    }
})
</script>

<style lang="scss" scoped>

</style>