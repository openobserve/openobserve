<!-- Copyright 2026 OpenObserve Inc.

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
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-2"
      style="font-size: 1.5rem"
    >
      <img
        data-test="no-regex-patterns-image"
        :src="getImageURL('images/regex_pattern/no_data_regex_pattern.svg')"
        style="width: 125px; margin: 0 auto 1rem"
        alt=""
      />
      <span data-test="no-regex-patterns-title" class="tw:font-semibold tw:text-base tw:leading-5 tw:text-left tw:tracking-[-0.6%]">{{ t("regex_patterns.no_data") }}</span>
        <span data-test="no-regex-patterns-subtitle" class="tw:text-sm tw:leading-5 tw:text-left tw:tracking-[-0.6%]">Import patterns from your Library or <span data-test="no-regex-patterns-create-new" class="tw:text-base tw:leading-6 tw:text-left tw:text-[#5960b2] tw:font-bold tw:cursor-pointer" @click="createNewRegexPattern">Create New</span></span>
        <div style="font-size: 1rem">
            <OButton variant="outline" size="xs" class="tw:mt-2" @click="importRegexPattern">
              {{ t("regex_patterns.import_title") }}
            </OButton>
        </div>    
    </div>
  </template>
  
  <script lang="ts">
  import { defineComponent } from "vue";
  import { useI18n } from "vue-i18n";
    import { getImageURL } from "@/utils/zincutils";
    import { useStore } from "vuex";
  import OButton from "@/lib/core/Button/OButton.vue";
  
  export default defineComponent({
    
    name: "NoRegexPatterns",
    components: { OButton },
    emits: ["create-new-regex-pattern", "import-regex-pattern"],
    setup(props, { emit }) {
      const { t } = useI18n();
      const store = useStore();
      const createNewRegexPattern = () => {
        emit("create-new-regex-pattern");
      }
      const importRegexPattern = () => {
        emit("import-regex-pattern");
      }
  
      return { t, getImageURL, store, createNewRegexPattern, importRegexPattern };
    },
  });
  </script>
