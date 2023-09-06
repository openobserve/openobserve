<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
    <div>
        <q-select style="min-width: 150px;" filled outlined dense v-model="selectedValue" :display-value="selectedValue ? selectedValue : !variableItem.isLoading ? '(No Data Found)' : ''" :label="variableItem?.label || variableItem?.name"
            :options="fieldsFilteredOptions" input-debounce="0" behavior="menu" use-input
            stack-label @filter="fieldsFilterFn" option-value="name" option-label="name" emit-value class="textbox col no-case"
            :loading="variableItem.isLoading">
            <template v-slot:no-option>
                <q-item>
                  <q-item-section class="text-italic text-grey">
                    No Data Found
                  </q-item-section>
                </q-item>
            </template>
        </q-select>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, toRef, watch } from 'vue';
import { useSelectAutoComplete } from '../../../composables/useSelectAutocomplete';

export default defineComponent({
    name: 'VariableQueryValueSelector',
    props: ["modelValue", "variableItem"],
    emits: ["update:modelValue"],
    setup(props: any, { emit }) {
        
        //get v-model value for selected value  using props
        const selectedValue = ref(props.variableItem?.value)

        const options = toRef(props.variableItem, 'options')

        // get filtered options
        const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } = useSelectAutoComplete(options, 'name')
        
        // set watcher on variable item changes at that time change the option value
        watch(() => props.variableItem, () => {
            options.value = props.variableItem?.options
        })

        // update selected value
        watch(selectedValue, () => {
            emit("update:modelValue", selectedValue.value)
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