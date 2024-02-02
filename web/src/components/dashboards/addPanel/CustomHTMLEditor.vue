<!-- Copyright 2023 Zinc Labs Inc.

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
  <div class="html-editor" style="width: 100%; height: 100%; overflow: auto">
    <div v-if="editMode" style="width: 100%; height: 100%">
      <q-splitter
        v-model="splitterModel"
        style="width: 100%; height: 100% !important"
        @update:modelValue="layoutSplitterUpdated"
      >
        <template #before>
          <div class="col" style="height: 100%">
            <HTMLEditor
              v-model="htmlContent"
              :debounceTime="500"
              @update:modelValue="onEditorValueChange"
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
          />
        </template>
        <template #after>
          <div v-html="htmlContent" class="preview"></div>
        </template>
      </q-splitter>
    </div>
    <div v-if="!editMode" class="preview" v-html="htmlContent"></div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import HTMLEditor from "./HTMLEditor.vue";

export default defineComponent({
  components: { HTMLEditor },
  name: "CustomHTMLEditor",
  props: {
    modelValue: {
      type: String,
      default: "",
    },
    editMode: {
      type: Boolean,
      default: false,
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

.preview {
  height: 98%;
  width: 100%;
}
</style>
