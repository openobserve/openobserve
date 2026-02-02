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
    class="markdown-editor card-container"
    style="width: 100%; height: 100%; overflow: hidden"
  >
    <div style="width: 100%; height: 100%">
      <q-splitter
        v-model="splitterModel"
        style="width: 100%; height: 100% !important"
        @update:modelValue="layoutSplitterUpdated"
        data-test="dashboard-markdown-editor-splitter"
      >
        <template #before>
          <div class="col" style="height: 100%; display: flex; flex-direction: column;">
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
          <div class="splitter-vertical splitter-enabled"></div>
          <q-avatar
            color="primary"
            text-color="white"
            size="20px"
            icon="drag_indicator"
            style="top: 10px; left: 3.5px"
            data-test="dashboard-markdown-editor-drag-indicator"
          />
        </template>
        <template #after>
          <markdown-renderer
            :markdown-content="markdownContent"
            :variables-data="initialVariableValues"
            :tabId="tabId"
            :panelId="panelId"
          />
        </template>
      </q-splitter>
    </div>
  </div>
</template>

<script lang="ts">
import { defineAsyncComponent, defineComponent, ref } from "vue";
import MarkdownRenderer from "../panels/MarkdownRenderer.vue";

export default defineComponent({
  components: {
    CodeQueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    MarkdownRenderer,
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

<style scoped>
.markdown-editor {
  display: flex;
  height: 100%;
}

.splitter {
  height: 4px;
  width: 100%;
}
.splitter-vertical {
  width: 4px;
  height: 100%;
}
.splitter-enabled {
  background-color: #ffffff00;
  transition: 0.3s;
  transition-delay: 0.2s;
}

.splitter-enabled:hover {
  background-color: orange;
}

:deep(.query-editor-splitter .q-splitter__separator) {
  background-color: transparent !important;
}
</style>
