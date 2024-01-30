<template>
  <div class="html-editor">
    <q-input v-model="htmlContent" filled type="textarea" class="editor" />
    <div v-html="htmlContent" class="preview"></div>
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
  },
  setup(props, { emit }) {
    const htmlContent = ref(props.modelValue);

    watch(htmlContent, (newVal) => {
      emit("update:modelValue", newVal);
    });

    return {
      htmlContent,
    };
  },
});
</script>

<style scoped>
.html-editor {
  display: flex;
}

.editor {
  width: 50%;
  min-height: 100%;
  max-height: 100%;
}

.preview {
  width: 50%;
  height: 100%;
  overflow-y: auto;
}
</style>
