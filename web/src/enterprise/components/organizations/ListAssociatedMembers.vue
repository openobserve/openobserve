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
  <div v-if="memberData.length == 0" class="q-pt-md text-center">
    No data available.
  </div>
  <div v-else class="q-pt-md round-box" id="data-list">
    <q-toolbar class="bordered-toolbar-title">
      <q-toolbar-title>Member List</q-toolbar-title>
    </q-toolbar>
    <q-list bordered separator style="overflow: auto; max-height: calc(800vh)">
      <q-item
        v-for="member in memberData"
        :key="member.email"
        v-ripple
        bordered
        clickable
      >
        <q-item-section>{{ member.email }}</q-item-section>
        <q-item-section side
          ><q-item-label caption> {{ member.status }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent } from "vue";

export default defineComponent({
  name: "ListAssociatedMembers",
  props: {
    // eslint-disable-next-line vue/require-default-prop
    data: {
      type: Array,
    },
  },
  setup() {
    return {};
  },
  data() {
    return {
      memberData: this.data,
    };
  },
});
</script>

<style lang="scss">
.round-box {
  border-radius: 2px;
  & > :first-of-type {
    border-radius: 2px 2px 0 0;
  }
  & > :last-of-type {
    border-radius: 0 0 2px 2px;
  }

  .bordered-toolbar-title {
    border: 1px solid $input-border;
    border-bottom: none;

    .q-toolbar__title {
      font-size: 0.75rem;
      font-weight: bold;
    }
  }
}
</style>
