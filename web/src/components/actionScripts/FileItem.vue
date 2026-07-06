<template>
  <li
    class="cursor-pointer py-[1px] px-2 hover:bg-gray-200 text-[14px] rounded-[2px] flex h-[25px] group file-item"
    :class="{
      'bg-primary text-white': isActive,
    }"
    @click="openFile"
  >
    <div class="w-[calc(100%-40px)] flex items-center">
      <template v-if="isEditing">
        <input
          ref="nameInput"
          v-model.trim="fileName"
          class="w-full border rounded h-full bg-transparent border-none outline-none"
          :class="isActive ? 'text-white' : 'text-black'"
          @blur="onBlur"
        />
      </template>
      <template v-else>
        {{ fileName }}
      </template>
    </div>
    <div
      class="w-[36px] flex items-center space-x-2 ml-auto invisible group-hover:visible file-actions"
    >
      <OButton variant="ghost" size="icon-xs-sq" @click.stop="editFile">
        <OIcon name="edit" size="sm" :class="isActive ? 'text-gray-100' : 'text-gray-600'" />
      </OButton>
      <OButton variant="ghost" size="icon-xs-sq" @click.stop="deleteFile">
        <OIcon name="delete" size="sm" :class="isActive ? 'text-gray-100' : 'text-gray-600'" />
      </OButton>
    </div>
  </li>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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

