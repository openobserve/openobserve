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
    class="html-editor card-container"
    style="width: 100%; height: 100%; overflow: hidden"
  >
    <div
      data-test="dashboard-custom-html-editor-inner"
      style="width: 100%; height: 100%"
    >
      <OSplitter
        v-model="splitterModel"
        style="width: 100%; height: 100% !important"
        @update:modelValue="layoutSplitterUpdated"
        data-test="dashboard-html-editor-splitter"
      >
        <template #before>
          <div
            data-test="dashboard-custom-html-editor-flex-col"
            class="tw:flex tw:flex-col"
            style="height: 100%; display: flex; flex-direction: column;"
          >
            <CodeQueryEditor
              language="html"
              v-model:query="htmlContent"
              :debounceTime="500"
              @update:query="onEditorValueChange"
              data-test="dashboard-html-editor"
              style="height: 100%; flex: 1;"
            />
          </div>
        </template>
        <template #separator>
          <div class="splitter-vertical splitter-enabled"></div>
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
    CodeQueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
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

<style scoped>
.html-editor {
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
  background-color: var(--o2-border, #e5e7eb);
  transition: background-color 0.3s;
}

.splitter-enabled:hover {
  background-color: orange;
}

:deep(.query-editor-splitter .q-splitter__separator) {
  background-color: transparent !important;
}
</style>
