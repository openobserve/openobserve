<<template>
    <div>
        <div class="column full-height">
            <div class="col">
                <div class="text-body1 text-bold text-dark">
                    Name of variable
                </div>
          </div>
        </div>
        <div class="flex">
            <div>
                <q-select
                    outlined
                    dense
                    v-model="variableData.selectedValue"
                    :options="variableData.variableType"
                    label=""
                ></q-select>
            </div>
            <q-separator></q-separator>
            <div>
                <q-input v-model="variableData.name" :label="variableData.name" dense outlined readonly></q-input>
            </div>
            <div>
                <q-input v-model="variableData.label" :label="variableData.label" dense outlined readonly></q-input>
            </div>
            
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, onMounted, onActivated } from "vue";
    export default defineComponent({
        name:"AddSettingVariable",
        props: [],
        emits: [],
        setup(props) {
            const variableData = reactive({
                name: "",
                label:"",
                selectedValue : '',
                variableType: [
                    {
                        label: 'Query',
                        value: 'query'
                    },
                    {
                        label: 'Constant',
                        value: 'constant'
                    },
                    {
                        label: 'Textbox',
                        value: 'textbox'
                    },
                    {
                        label: 'Custom Fields',
                        value: 'custom_fields'
                    }
                ]

            })
            return {
                variableData
            }
        }
        
    })
</script>

<style lang="scss" scoped>

</style>