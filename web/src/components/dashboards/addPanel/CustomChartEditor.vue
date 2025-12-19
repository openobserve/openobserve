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
    style="width: 100%; height: 100%; overflow: hidden; display: flex; flex-direction: column;"
  >
    <div style="width: 100%; height: 100%; display: flex; flex-direction: column;">
          <div class="col" style="height: 100%; display: flex; flex-direction: column;">
            <QueryEditor
              v-model:query="javascriptCodeContent"
              :debounceTime="500"
              @update:query="onEditorValueChange"
              data-test="dashboard-markdown-editor-query-editor"
              language="javascript"
              class="javascript-query-editor "
              style="padding-left: 20px; height: 100%; flex: 1;"
              :style="{
                backgroundColor:
                  store.state.theme == 'dark'
                    ? '#1e1e1e'
                    : '#fafafa',
              }"

            />
          </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  watch,
} from "vue";
import QueryEditor from "@/components/CodeQueryEditor.vue";
import { useStore } from "vuex";
import useDashboardPanelData from "@/composables/useDashboardPanel";

export default defineComponent({
  components: {
    QueryEditor,
  },
  name: "CustomChartEditor",
  props: {
    modelValue: {
      type: String,
      default: `\ // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// The data variable is accessible and holds the response data from the search result, which is formatted as an array.\noption = {  \n \n};
  `,
    },
  },
  setup(props, { emit }): any {
    const javascriptCodeContent = ref(props.modelValue);
    const splitterModel = ref(50);
    const dataToBeRendered = ref({});
    const store = useStore();
    const { dashboardPanelData } = useDashboardPanelData("dashboard");

    // Watch for prop changes and update the editor content
    watch(() => props.modelValue, (newValue) => {
      if (newValue !== javascriptCodeContent.value) {
        javascriptCodeContent.value = newValue;
      }
    });

    const layoutSplitterUpdated = () => {
      window.dispatchEvent(new Event("resize"));
    };

    const onEditorValueChange = (newVal: any) => {
      try {
        javascriptCodeContent.value = newVal;
        emit("update:modelValue", newVal);
      } catch (error) {
        console.error("Error processing newVal:", error);
      }
    };

    return {
      javascriptCodeContent,
      splitterModel,
      layoutSplitterUpdated,
      onEditorValueChange,
      dataToBeRendered,
      store,
      dashboardPanelData,
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
.javascript-query-editor {
}
</style>
