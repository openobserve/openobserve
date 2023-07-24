<template>
    <div>
        <q-select style="min-width: 150px;" filled outlined dense v-model="selectedValue" :label="variableItem?.label || variableItem?.name"
            :options="fieldsFilteredOptions" input-debounce="0" behavior="menu" use-input
            stack-label @filter="fieldsFilterFn" option-value="name" option-label="name" emit-value class="textbox col no-case"
        ></q-select>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, toRef, watch } from 'vue';
import { useSelectAutoComplete } from '../../../composables/useSelectAutocomplete';

export default defineComponent({
    name: 'VariableQueryValueSelector',
    props: ["modalValue", "variableItem"],
    emits: ["update:modalValue"],
    setup(props: any, { emit }) {
        console.log("----variableItem-----", props.variableItem);
        
        const selectedValue = ref(props.variableItem?.value)

        const options = toRef(props.variableItem, 'options')

        const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } = useSelectAutoComplete(options, 'name')
        
        watch(() => props.variableItem, () => {
            options.value = props.variableItem?.options
        })

        watch(selectedValue, () => {
            emit("update:modalValue", selectedValue.value)
        })

        return {
            selectedValue,
            fieldsFilterFn,
            fieldsFilteredOptions
        }
    }
})
</script>

<style lang="scss" scoped>

</style>