<template>
  <div class="html-editor">
    <div v-if="editMode" style="width: 100%; height: 100%">
      <q-splitter v-model="splitterModel" style="width: 100%; height: 100%">
        <template #before>
          <div style="min-height: 500px">
            <q-input
              v-model="htmlContent"
              filled
              type="textarea"
              class="editor"
              style="min-height: 500px"
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
    <div v-if="!editMode">
      <div v-html="htmlContent" class="preview"></div>
    </div>
  </div>
</template>

<script>
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
