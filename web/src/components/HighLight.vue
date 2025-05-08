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
    <span
      v-for="(item) in list"
      :key="item.id"
      :title="title"
      :class="{ highlight: item.isKeyWord }"
    >
      {{ item.text }}
    </span>
</template>

<script lang="ts">
import { getUUID } from "@/utils/zincutils";
import { defineComponent, ref, watch, computed, onBeforeMount } from "vue";

export default defineComponent({
  name: "HighLight",
  props: {
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
  setup(props) {
    const list = ref<any>([]);
    let timeoutId: ReturnType<typeof setTimeout>;
    //this function is used to get the keywords from the query string
    //which matches match_all(string) , fuzzy_match_all(string, number)
    //it should only match the string and not the number in fuzzy_match_all
    const getKeywords = (queryString: string): string[] => {
      if (!queryString?.trim()) return [];

      const regex = /\b(?:match_all|fuzzy_match_all)\(\s*(['"])([^'"]+)\1(?:\s*,\s*\d+)?\s*\)/g;
      const result: string[] = [];
      let match;

      while ((match = regex.exec(queryString)) !== null) {
        if (match[2]) result.push(match[2]);
        else if (match[4] && !/^[a-zA-Z_]+\s*=\s*$/.test(match[4])) {
          result.push(match[4]);
        }
      }
    return Array.from(new Set(result));
  };


    //it takes the content and the keywords and returns the content with the keywords highlighted
    const highlightText = (content: any, keywords: string[]) => {
      const result = [];
      let remaining = typeof content === "number" ? content.toString() : content;
      if (!keywords.length || !remaining) return [{ isKeyWord: false, text: remaining }];

      //this pattern is used to highlight the keywords in the content
      //it is a regular expression that matches the keywords in the content
      const pattern = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
      const parts = remaining.split(pattern);

      for (const part of parts) {
        if (!part) continue;
        const isKeyWord = keywords.some(k => k.toLowerCase() === part.toLowerCase());
        result.push({ isKeyWord, text: part, id: getUUID() });
      }
      return result;
    };

    const updateList = () => {
      const keywords = getKeywords(props.queryString);
      list.value = highlightText(props.content, keywords);
    };

    watch(() => props.content, updateList, { immediate: true });
    watch(() => props.queryString, () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(updateList, 300); // debounce duration
    });

    //this is used to clear the timeout when the component is destroyed
    //this is used to prevent memory leaks
    onBeforeMount(() => {
      clearTimeout(timeoutId);
    });

    return { list };
  },
});
</script>

<style scoped>
.highlight {
  background-color: rgb(255, 213, 0);
}
</style>
