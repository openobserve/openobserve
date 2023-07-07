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
    <div>
        <div class="row items-center no-wrap">
            <div v-if="backButton" class="col-auto">
                <q-btn no-caps @click="onBackClicked" padding="xs" outline icon="arrow_back_ios_new" />
            </div>
            <div class="col">
                <div class="q-mb-sm text-h6">
                    {{ title }}
                </div>
            </div>
            <div class="col-auto">
                <slot name="right"></slot>
            </div>
        </div>
        <q-separator class="q-mb-sm" />
    </div>
</template>
  
<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
    name: "DashboardHeader",
    components: {
    },
    props: {
        title: {
            type: String,
            default: ""
        },
        backButton: {
            type: Boolean,
            default: false
        }
    },
    emits: ["back"],
    setup(props, { emit }) {

        const onBackClicked = () => {
            emit("back")
        }

        return {
            onBackClicked
        };
    },
});
</script>
  
<style scoped lang="scss"></style>
  