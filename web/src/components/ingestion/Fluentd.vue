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
  <div class="tabContent">
    <div class="tabContent__head">
      <div class="title">Fluentd</div>
      <div class="copy_action">
        <q-btn
          flat
          round
          size="0.5rem"
          padding="0.6rem"
          icon="img:/src/assets/images/common/copy_icon.svg"
          @click="$emit('copy-to-clipboard-fn', fluentdContent)"
        />
      </div>
    </div>
    <pre ref="fluentdContent">
&lt;source&gt;
  @type forward
  port 24224
  bind 0.0.0.0
&lt;/source&gt;

&lt;match **&gt;
  @type copy
  &lt;store&gt;
    @type http
    host {{ config.zincENLIngestion }}
    port 443
    scheme https
    path /api/{{ currOrgIdentifier }}/default/_json
    user {{ currUserEmail }}
    password {{ store.state.organizationPasscode }}
    index_name default
  &lt;/store&gt;
&lt;/match&gt;</pre
    >
  </div>
</template>

<script>
import { defineComponent, ref } from "vue";
import config from "../../aws-exports";
import { useStore } from "vuex";

export default defineComponent({
  name: "fluentd-mechanism",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
  },
  setup() {
    const store = useStore();

    const fluentdContent = ref(null);
    return {
      store,
      config,
      fluentdContent,
    };
  },
});
</script>

<style scoped lang="scss">
.tabContent {
  background-color: $accent; // tab content bg color
  padding: 1rem 1.25rem 0.5rem;
  border-radius: 0.5rem;

  &__head {
    justify-content: space-between;
    text-transform: uppercase;
    align-items: center;
    display: flex;

    .title {
      font-size: 0.75rem;
      color: $dark-page;
      line-height: 1rem;
      font-weight: 600;
    }

    .copy_action {
      .q-btn {
        background-color: white;
      }
    }
  }

  pre {
    white-space: pre-wrap;
    word-wrap: break-word;
    font-size: 0.75rem;
    color: $dark-page;
    margin-bottom: 0;
  }
}
</style>
