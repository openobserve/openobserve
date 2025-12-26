<template>
  <li
    class="tw:cursor-pointer tw:py-[1px] tw:px-2 hover:tw:bg-gray-200 tw:text-[14px] tw:rounded-[2px] tw:flex tw:h-[25px] file-item"
    :class="{
      'bg-primary tw:text-white': isActive,
    }"
    @click="openFile"
  >
    <div class="tw:w-[calc(100%-40px)] tw:flex tw:items-center">
      <template v-if="isEditing">
        <input
          ref="nameInput"
          v-model.trim="fileName"
          class="tw:w-full tw:border tw:rounded tw:h-full tw:bg-transparent tw:border-none tw:outline-none"
          :class="isActive ? 'tw:text-white' : 'tw:text-black'"
          @blur="onBlur"
        />
      </template>
      <template v-else>
        {{ fileName }}
      </template>
    </div>
    <div
      class="tw:w-[36px] tw:flex tw:items-center tw:space-x-2 tw:ml-auto file-actions"
    >
      <button
        @click.stop="editFile"
        :class="isActive ? 'tw:text-gray-100' : 'tw:text-gray-600'"
      >
        <q-icon name="edit" />
      </button>
      <button
        @click.stop="deleteFile"
        :class="isActive ? 'tw:text-gray-100' : 'tw:text-gray-600'"
      >
        <q-icon name="delete" />
      </button>
    </div>
  </li>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from "vue";

const props = defineProps<{
  name: string;
  isActive: boolean;
  editMode: boolean;
}>();

const emit = defineEmits(["open-file", "update:name", "delete-file"]);

const isEditing = ref(false);

const nameInput = ref<HTMLInputElement | null>(null);

const openFile = () => {
  emit("open-file");
};

const prevFileName = ref(props.name);

const fileName = computed({
  get: () => props.name,
  set: (val) => {
    emit("update:name", val);
  },
});

const editFile = async () => {
  if (fileName.value) prevFileName.value = fileName.value;
  focusInput();
};

const focusInput = async () => {
  isEditing.value = true;
  await nextTick();
  nameInput.value?.focus();
};

watch(
  () => props.editMode,
  (val) => {
    if (val) {
      focusInput();
    }
  },
  {
    immediate: true,
  },
);

const onBlur = () => {
  isEditing.value = false;
  if (!props.name) {
    emit("update:name", prevFileName.value || "new.py");
  }
};

const deleteFile = () => {
  emit("delete-file");
};
</script>

<style scoped lang="scss">
.file-item {
  .file-actions {
    visibility: hidden;
  }
  &:hover {
    .file-actions {
      visibility: visible;
    }
  }
}
</style>
