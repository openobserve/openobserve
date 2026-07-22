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
    data-test="dashboard-custom-html-editor-container"
    class="bg-card-glass-bg w-full h-full overflow-hidden"
  >
    <div class="w-full h-full" data-test="dashboard-custom-html-editor-inner">
      <OSplitter
        v-model="splitterModel"
        class="w-full h-full!"
        @update:modelValue="layoutSplitterUpdated"
        data-test="dashboard-html-editor-splitter"
      >
        <template #before>
          <div data-test="dashboard-custom-html-editor-flex-col" class="flex flex-col h-full">
            <CodeQueryEditor
              class="h-full flex-1"
              language="html"
              v-model:query="htmlContent"
              :debounceTime="500"
              @update:query="onEditorValueChange"
              data-test="dashboard-html-editor"
            />
          </div>
        </template>
        <template #separator>
          <div
            class="w-1 h-full bg-border-default transition-colors hover:bg-table-resize-handle"
          ></div>
        </template>
        <template #after>
          <HTMLRenderer
            :htmlContent="htmlContent"
            :variables-data="initialVariableValues"
            :tabId="tabId"
            :panelId="panelId"
          />
        </template>
      </OSplitter>
    </div>
  </div>
</template>

<script lang="ts">
import { defineAsyncComponent, defineComponent, ref } from "vue";
import HTMLRenderer from "../panels/HTMLRenderer.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";

export default defineComponent({
  components: {
    CodeQueryEditor: defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue")),
    HTMLRenderer,
    OSplitter,
  },
  name: "CustomHTMLEditor",
  props: {
    modelValue: {
      type: String,
      default: "",
    },
    initialVariableValues: {
      type: Object,
      default: () => ({}),
    },
    tabId: {
      type: String,
      default: null,
    },
    panelId: {
      type: String,
      default: null,
    },
  },
  setup(props, { emit }) {
    const htmlContent = ref(props.modelValue);
    const splitterModel = ref(50);

    const layoutSplitterUpdated = () => {
      window.dispatchEvent(new Event("resize"));
    };

    const onEditorValueChange = (newVal: any) => {
      htmlContent.value = newVal;
      emit("update:modelValue", newVal);
    };

    return {
      htmlContent,
      splitterModel,
      layoutSplitterUpdated,
      onEditorValueChange,
    };
  },
});
</script>
