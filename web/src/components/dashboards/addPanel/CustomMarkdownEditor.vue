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
    data-test="dashboard-custom-markdown-editor-container"
    class="card-container"
    style="width: 100%; height: 100%; overflow: hidden"
  >
    <div
      data-test="dashboard-custom-markdown-editor-inner"
      style="width: 100%; height: 100%"
    >
      <OSplitter
        v-model="splitterModel"
        style="width: 100%; height: 100% !important"
        @update:modelValue="layoutSplitterUpdated"
        data-test="dashboard-markdown-editor-splitter"
      >
        <template #before>
          <div
            data-test="dashboard-custom-markdown-editor-flex-col"
            class="flex flex-col"
            style="height: 100%; display: flex; flex-direction: column;"
          >
            <CodeQueryEditor
              language="markdown"
              v-model:query="markdownContent"
              :debounceTime="500"
              @update:query="onEditorValueChange"
              data-test="dashboard-markdown-editor"
              style="height: 100%; flex: 1;"
            />
          </div>
        </template>
        <template #separator>
          <div
            data-test="dashboard-custom-markdown-editor-splitter-separator"
            class="w-1 h-full bg-[var(--o2-border,#e5e7eb)] transition-colors hover:bg-orange-500"
          ></div>
        </template>
        <template #after>
          <markdown-renderer
            :markdown-content="markdownContent"
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
import MarkdownRenderer from "../panels/MarkdownRenderer.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";

export default defineComponent({
  components: {
    CodeQueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    MarkdownRenderer,
    OSplitter,
  },
  name: "CustomMarkdownEditor",
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
  setup(props, { emit }): any {
    const markdownContent = ref(props.modelValue);
    const splitterModel = ref(50);

    const layoutSplitterUpdated = () => {
      window.dispatchEvent(new Event("resize"));
    };

    const onEditorValueChange = (newVal: any) => {
      markdownContent.value = newVal;
      emit("update:modelValue", newVal);
    };

    return {
      markdownContent,
      splitterModel,
      layoutSplitterUpdated,
      onEditorValueChange,
    };
  },
});
</script>

<style>
:deep(.query-editor-splitter .q-splitter__separator) {
  background-color: transparent !important;
}
</style>
