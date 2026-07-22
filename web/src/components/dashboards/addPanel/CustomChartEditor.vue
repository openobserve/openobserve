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
    data-test="dashboard-custom-chart-editor-container"
    class="bg-card-glass-bg w-full h-full overflow-hidden flex flex-col"
  >
    <div class="w-full h-full flex flex-col" data-test="dashboard-custom-chart-editor-inner">
      <div data-test="dashboard-custom-chart-editor-flex-col" class="flex flex-col h-full">
        <QueryEditor
          v-model:query="javascriptCodeContent"
          :debounceTime="500"
          @update:query="onEditorValueChange"
          data-test="dashboard-markdown-editor-query-editor"
          language="javascript"
          class="javascript-query-editor pl-5 h-full flex-1 bg-code-block-bg"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import { defineAsyncComponent } from "vue";
const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));
import { useStore } from "vuex";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";

export default defineComponent({
  components: {
    QueryEditor,
  },
  name: "CustomChartEditor",
  props: {
    modelValue: {
      type: String,
      default: ` // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// The data variable is accessible and holds the response data from the search result, which is formatted as an array.\noption = {  \n \n};
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
    watch(
      () => props.modelValue,
      (newValue) => {
        if (newValue !== javascriptCodeContent.value) {
          javascriptCodeContent.value = newValue;
        }
      },
    );

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
