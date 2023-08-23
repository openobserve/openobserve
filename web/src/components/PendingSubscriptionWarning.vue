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
  <div class="row col-11 justify-center q-mt-xl">
    <q-icon
      name="warning"
      size="80px"
      color="warning row col-8 justify-center q-mt-lg"
    /><br />
    <h5>
      <b
        ><u><span class="text-red">Warning:</span></u></b
      >
      The content of this page cannot be viewed because the selected
      organization's is on pending subscription state. <br /><br /><q-btn color="primary" @click="routerPush">Click here to proceed with subscription</q-btn>
    </h5>
  </div>
</template>

<script lang="ts">
import { useRouter } from "vue-router";
// @ts-nocheck
import { defineComponent } from "vue";

export default defineComponent({
  name: "PendingSubscriptionWarning",
  setup() {
    const router = useRouter();

    const routerPush = () => {
      router.push({ name: "plans" });
    };

    return {
      router,
      routerPush,
    };
  },
});
</script>
