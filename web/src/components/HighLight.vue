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
    <span v-for="item in list" :key="item.key" v-bind="item">
      <span :title="title" v-if="item.isKeyWord" class="highlight">{{
        item.text
      }}</span>
      <span :title="title" v-else>{{ item.text }}</span>
    </span>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref } from "vue";

export default defineComponent({
  name: "HighLight",
  props: {
    // eslint-disable-next-line vue/require-prop-types
    content: {
      required: true,
    },
    queryString: {
      type: String,
      default: "",
    },
    title: {
      type: String,
      default: "",
    },
  },
  data() {
    return {
      list: ref([]),
      keywords: ref([]),
    };
  },
  watch: {
    content: {
      handler() {
        this.init();
      },
    },
    queryString: {
      handler() {
        //added timeout to delay the highlight process to avoid
        //performance issue while writing query in editor
        setTimeout(() => {
          this.keywords = this.getKeywords(this.queryString);
          this.init();
        }, 2000);
      },
    },
  },
  mounted() {
    this.keywords = this.getKeywords(this.queryString);
    this.init();
  },
  methods: {
    init() {
      this.list = this.splitToList(this.content, this.keywords);
    },
    splitToList(content: any, keywords: string | any[]) {
      let arr = [
        {
          isKeyWord: false,
          text: content,
        },
      ];
      for (let i = 0; i < keywords.length; i++) {
        const keyword = keywords[i];
        let j = 0;
        while (j < arr.length) {
          let rec = arr[j];
          let record = rec.text.split(keyword);

          if (
            record != undefined &&
            typeof record == "object" &&
            record.length > 1
          ) {
            // delete j replace by new
            arr.splice(j, 1);
            let recKeyword = {
              isKeyWord: true,
              text: keyword,
            };
            for (let k = 0; k < record.length; k++) {
              let r = {
                isKeyWord: false,
                text: record[k],
              };
              if (k == record.length - 1) {
                arr.splice(j + k * 2, 0, r);
              } else {
                arr.splice(j + k * 2, 0, r, recKeyword);
              }
            }
          }
          if (record != undefined && typeof record == "object") {
            j = j + record.length;
          } else {
            j++;
          }
        }
      }
      return arr;
    },
    getKeywords(queryString: string) {
      if (!queryString || queryString.trim().length == 0) {
        return [];
      }

      const regex =
        /(?:match_all\((['"])([^'"]+)\1\)|match_all_ignore_case\((['"])([^'"]+)\3\)|(['"])([^'"]+)\5)/g;

      let result = [];
      let match;

      while ((match = regex.exec(queryString)) !== null) {
        // Group 1: match_all values
        if (match[2]) {
          result.push(match[2]);
        }
        // Group 2: match_all_ignore_case values
        else if (match[4]) {
          result.push(match[4]);
        }
        // Group 3: other string values
        else if (match[6]) {
          const columnNamePattern = /^[a-zA-Z_]+\s*=\s*$/;
          if (!columnNamePattern.test(match[6])) {
            result.push(match[6]);
          }
        }
      }

      return result;
    },
  },
});
</script>
<style lang="scss">
.highlight {
  background-color: rgb(255, 213, 0);
}
</style>
