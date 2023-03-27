!-- Copyright 2022 Zinc Labs Inc. and Contributors

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
  <div
  class="flex justify-center q-pa-xl text-dark"
  style="font-size: 1.5rem"
  >
    <q-btn 
        :label="t('panel.add')"
        no-caps color="primary"
        stack 
        text-color="black" 
        padding="xl" 
        outline icon="insert_drive_file"
        class=""
        @click="$emit('update:Panel')"
    >
    <!-- <q-img
        :src="getImageURL('images/common/clipboard_icon.svg')"
        style="width: 230px; margin: 20vh auto 2rem"
      /> -->
      </q-btn>
  </div>
</template>
<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { getImageURL } from "../../../utils/zincutils";

export default defineComponent({
  name: "NoPanel",
  props: ["Panel"],
  emits: ["update:Panel"],

  setup() {
    const { t } = useI18n();

    return { t , getImageURL};
  },
});
</script>
