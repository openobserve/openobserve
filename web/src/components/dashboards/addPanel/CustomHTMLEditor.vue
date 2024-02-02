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
      <q-splitter v-model="splitterModel" style="width: 100%; height: 100%">
        <template #before>
          <div style="height: 100% !important">
            <q-input
              v-model="htmlContent"
              filled
              type="text"
              class="editor"
              placeholder="Enter here"
              autogrow
              :input-style="{ minHeight: 'calc(100vh - 119px)' }"
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

export default defineComponent({
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

    watch(htmlContent, (newVal) => {
      emit("update:modelValue", newVal);
    });

    return {
      htmlContent,
      splitterModel,
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
