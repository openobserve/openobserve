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
  <q-dialog v-model="isVisible" persistent>
    <q-card
      class="custom-confirm-dialog"
      :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
    >
      <!-- Header -->
      <q-card-section class="dialog-header tw:pb-3">
        <div class="dialog-title">{{ title }}</div>
      </q-card-section>

      <!-- Content -->
      <q-card-section class="dialog-content tw:py-4">
        <div class="message-text">{{ message }}</div>
      </q-card-section>

      <!-- Actions -->
      <q-card-actions class="dialog-actions tw:flex tw:justify-end tw:gap-2 tw:px-4 tw:pb-4">
        <q-btn
          data-test="custom-cancel-button"
          label="Cancel"
          unelevated
          no-caps
          class="o2-secondary-button"
          @click="onCancel"
        />
        <q-btn
          data-test="custom-confirm-button"
          label="Clear & Continue"
          unelevated
          no-caps
          class="o2-primary-button"
          @click="onConfirm"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import { useStore } from "vuex";

export default defineComponent({
  name: "CustomConfirmDialog",
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String,
      default: "Confirm Action",
    },
    message: {
      type: String,
      default: "",
    },
  },
  emits: ["update:modelValue", "confirm", "cancel"],
  setup(props, { emit }) {
    const store = useStore();
    const isVisible = ref(props.modelValue);

    // Watch for prop changes
    watch(
      () => props.modelValue,
      (newVal) => {
        isVisible.value = newVal;
      }
    );

    // Watch for internal visibility changes
    watch(isVisible, (newVal) => {
      emit("update:modelValue", newVal);
    });

    const onCancel = () => {
      isVisible.value = false;
      emit("cancel");
    };

    const onConfirm = () => {
      isVisible.value = false;
      emit("confirm");
    };

    return {
      store,
      isVisible,
      onCancel,
      onConfirm,
    };
  },
});
</script>

<style scoped lang="scss">
.custom-confirm-dialog {
  min-width: 420px;
  max-width: 480px;
  border-radius: 8px;
  overflow: hidden;

  &.dark-mode {
    background-color: #1a1a1a;
    border: 1px solid #343434;

    .dialog-header {
      border-bottom: 1px solid #343434;

      .dialog-title {
        color: #ffffff;
        font-weight: 600;
        font-size: 16px;
      }
    }

    .dialog-content {
      .message-text {
        color: #d0d0d0;
        font-size: 14px;
        line-height: 1.6;
      }
    }
  }

  &.light-mode {
    background-color: #ffffff;
    border: 1px solid #e0e0e0;

    .dialog-header {
      border-bottom: 1px solid #e0e0e0;

      .dialog-title {
        color: #1a1a1a;
        font-weight: 600;
        font-size: 16px;
      }
    }

    .dialog-content {
      .message-text {
        color: #424242;
        font-size: 14px;
        line-height: 1.6;
      }
    }
  }
}

.dialog-header {
  padding: 16px 20px;
}

.dialog-content {
  padding: 12px 20px;
}

.dialog-actions {
  padding-top: 8px;
}
</style>
