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
      <span v-if="item.isKeyWord" class="highlight">{{ item.text }}</span>
      <span v-else>{{ item.text }}</span>
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
        this.keywords = this.getKeywords(this.queryString);
        this.init();
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
          if (record.length > 1) {
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
          j = j + record.length;
        }
      }
      return arr;
    },
    getKeywords(queryString: string) {
      if (!queryString || queryString.trim().length == 0) {
        return [];
      }

      let arr = [];
      // queryString + " " is for special split regular
      // split by space, but ignore double quotation marks
      const groups = (queryString + " ").split(/ s*(?![^"]*"\ )/);
      for (let i = 0; i < groups.length - 1; i++) {
        const group = groups[i];
        if (!group || group.trim().length == 0) {
          continue;
        }
        // group + ":" is for special split regular
        // split by :, but ignore "
        const fieldWordArr = (group + ":").split(/:s*(?![^"]*"\:)/);
        let keyword = group;
        if (fieldWordArr.length > 2) {
          keyword = fieldWordArr[1];
        }
        // delete start and end of * and "
        keyword = keyword
          .replace(/(^\**)|(\**$)/g, "")
          .replace(/(^"*)|("*$)/g, "");
        if (keyword.trim().length > 0) {
          // make sure key not empty or not space
          arr.push(keyword);
        }
      }
      return arr;
    },
  },
});
</script>
<style lang="scss">
.highlight {
  background-color: rgb(255, 213, 0);
}
</style>
