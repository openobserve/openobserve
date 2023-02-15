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
  <q-page class="aboutPage">
    <div class="about_head">
      <img
        src="/src/assets/images/common/app_logo_zo.png"
        class="logo"
        width="177"
      />
      <div class="para">Observability simplified.</div>
    </div>

    <q-separator class="separator" />

    <div class="about_data">
      <div class="row head">
        <div class="col-1">Version</div>
        <div class="col-6 col-md-5 col-lg-4">Commit Hash</div>
        <div class="col-3 col-md-3 col-lg-2">Build Date</div>
      </div>
      <div class="row body">
        <div class="col-1">{{ zoConfig.version }}</div>
        <div class="col-6 col-md-5 col-lg-4">
          {{ zoConfig.commit }}
        </div>
        <div class="col-3 col-md-3 col-lg-2">{{ zoConfig.date }}</div>
      </div>
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useStore } from "vuex";

export default defineComponent({
  name: "PageAbout",
  // components: {},
  setup() {
    const store = useStore();
    const pageData = ref("Page Data");
    var zoConfig = store.state.zoConfig;
    return {
      pageData,
      zoConfig,
    };
  },
  // methods: {},
});
</script>

<style lang="scss" scoped>
.aboutPage {
  padding: 2.25rem 1.5rem;

  .about_head,
  .about_data {
    padding: 0 1.5rem;
  }

  .logo {
    margin-bottom: 0.5rem;
    display: block;
  }

  .para {
    color: $light-text;
    font-weight: 600;
  }

  .q-separator {
    margin: 1.5rem 0;
  }

  .about_data {
    .head {
      margin-bottom: 0.5rem;
      font-weight: 700;
      color: $dark;
    }

    .body {
      color: $light-text;
      font-weight: 600;
    }
  }
}
</style>
