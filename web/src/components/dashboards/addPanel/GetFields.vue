<!-- Copyright 2022 Zinc Labs Inc. and Contributors

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
    <div class="column" style="height: 100%">
        <div class="col-auto q-pa-sm">
            <span class="text-weight-bold">{{ t('panel.fields') }}</span>
        </div>
        <div class="col" style="width: 100%">
            <index-list :editMode="props.editMode"/>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from "vue"
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import IndexList from "./IndexList.vue"
import useDashboardPanelData from "../../../composables/useDashboardPanel";

    export default defineComponent({
        name: "GetFields",
        props:['editMode'],
        components: {
            IndexList,
        },
        setup(props){
            const store = useStore();
            const router = useRouter();
            const { dashboardPanelData } = useDashboardPanelData()
            const { t } = useI18n();

            return {
                store,
                router,
                dashboardPanelData,
                t,
                props
            }
        }
          
        
    })
</script>

<style lang="sass" scoped>

</style>