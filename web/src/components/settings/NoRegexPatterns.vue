<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
    <div
      class="full-width column flex-center q-gutter-sm q-mt-xs"
      style="font-size: 1.5rem"
      :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'"
    >
      <q-img
        :src="getImageURL('images/regex_pattern/no_data_regex_pattern.svg')"
        style="width: 125px; margin: 20vh auto 1rem"
      />
      <span class="title-text">{{ t("regex_patterns.no_data") }}</span>
        <span class="subtitle-text">Import Regex patterns from your Library or <span class="create-new-text" @click="createNewRegexPattern">Create New</span></span>
        <div class="import-button-container">
            <q-btn no-caps class="q-mt-sm" @click="importRegexPattern">
              <span class="import-button-text">Import Regex Pattern</span>
            </q-btn>
        </div>    
    </div>
  </template>
  
  <script lang="ts">
  import { defineComponent } from "vue";
  import { useI18n } from "vue-i18n";
    import { getImageURL } from "@/utils/zincutils";
    import { useStore } from "vuex";
import { useRouter } from "vue-router";
  
  export default defineComponent({
    
    name: "NoRegexPatterns",
    emits: ["create-new-regex-pattern"],
    setup(props, { emit }) {
      const { t } = useI18n();
      const store = useStore();
      const router = useRouter();
      const createNewRegexPattern = () => {
        emit("create-new-regex-pattern");
      }
      const importRegexPattern = () => {
        console.log("importRegexPattern");
      }
  
      return { t, getImageURL, store, router, createNewRegexPattern, importRegexPattern };
    },
  });
  </script>

  <style scoped>
  .title-text {
    font-weight: 600;
    font-size: 16px;
    line-height: 20px;
    text-align: left;
    letter-spacing: -0.6%;
  }
  .subtitle-text {
    font-size: 14px;
    line-height: 20px;
    letter-spacing: -0.6%;
    text-align: left;
  }
  .import-button-text{
    font-size: 16px;
    line-height: 24px;
    letter-spacing: 0%;
    text-align: left;
    color: #5960b2;
    font-weight: 600;
  }
  .create-new-text{
    font-size: 16px;
    line-height: 24px;
    letter-spacing: 0%;
    text-align: left;
    color: #5960b2;
    font-weight: 700;
    cursor: pointer;
  }
  .dark-mode{
    .title-text{
        color: #343434;
    }
    .subtitle-text{
        color: #343434;
    }
  }
  </style>