<template>
  <div
    :data-test="`${dataTest}-list-page`"
    class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:h-full tw:min-h-0"
  >
    <div v-if="showEmpty" class="tw:flex-1 tw:min-h-0">
      <div class="card-container tw:h-full tw:flex tw:items-center tw:justify-center">
        <slot name="empty" />
      </div>
    </div>

    <template v-else>
      <div class="tw:shrink-0">
        <div class="card-container tw:mb-[0.625rem]">
          <div class="tw:flex tw:justify-between tw:items-center tw:py-3 tw:px-4 tw:h-[68px]">
            <div
              :data-test="`${dataTest}-list-title`"
              class="tw:text-xl tw:tracking-[0.005em] tw:font-[600]"
            >
              {{ title }}
            </div>

            <div class="tw:flex tw:ml-auto tw:ps-2 tw:items-center">
              <OInput
                v-model="searchModel"
                class="tw:ml-2 tw:w-[200px]"
                :placeholder="searchPlaceholder"
                :data-test="`${dataTest}-list-search-input`"
              >
                <template #icon-left>
                  <OIcon name="search" size="sm" />
                </template>
              </OInput>

              <slot name="filter" />

              <slot name="actions" />

              <OButton
                :data-test="`${dataTest}-list-add-btn`"
                class="tw:ml-2"
                variant="primary"
                size="sm"
                @click="$emit('create')"
              >
                {{ addLabel }}
              </OButton>
            </div>
          </div>
        </div>
      </div>

      <div class="tw:flex-1 tw:min-h-0">
        <div class="card-container tw:h-full">
          <slot name="table" />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

const props = defineProps<{
  dataTest: string;
  title: string;
  search: string;
  searchPlaceholder: string;
  addLabel: string;
  showEmpty: boolean;
}>();

const emit = defineEmits<{
  (e: "update:search", value: string): void;
  (e: "create"): void;
}>();

const searchModel = computed({
  get: () => props.search,
  set: (v: string) => emit("update:search", v),
});
</script>
