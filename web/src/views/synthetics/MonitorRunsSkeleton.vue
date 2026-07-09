<template>
  <div class="flex flex-col gap-[0.875rem]">
    <!-- ════════ Status Timeline Skeleton ════════ -->
    <div
      class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
    >
      <div
        class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
      >
        <SkeletonBox width="100px" height="14px" rounded />
        <span class="flex-1" />
        <SkeletonBox width="45px" height="12px" rounded />
        <SkeletonBox width="50px" height="12px" rounded />
        <SkeletonBox width="45px" height="12px" rounded />
      </div>
      <div class="border-t border-[var(--o2-border-color)]" />
      <div class="flex flex-col gap-1 py-2 px-[0.875rem]">
        <div class="flex items-center gap-1">
          <div class="w-5 h-5 shrink-0" />
          <div class="flex-1 h-[26px] rounded flex gap-0.5 items-stretch">
            <div
              v-for="n in 26"
              :key="n"
              class="flex-1 h-full rounded-[2px]"
              style="background: var(--o2-border-color); opacity: 0.4"
            />
          </div>
          <div class="w-5 h-5 shrink-0" />
        </div>
        <div class="flex justify-between">
          <SkeletonBox width="60px" height="10px" rounded />
          <SkeletonBox width="80px" height="10px" rounded />
          <SkeletonBox width="60px" height="10px" rounded />
        </div>
      </div>
    </div>

    <!-- ════════ KPI Cards Skeleton ════════ -->
    <div class="grid grid-cols-5 gap-[0.625rem]">
      <div
        v-for="n in 5"
        :key="n"
        class="card-container rounded-lg flex flex-col px-[0.875rem] pt-[0.625rem] pb-[0.625rem] gap-[0.25rem] bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)]"
      >
        <SkeletonBox width="60%" height="11px" rounded />
        <SkeletonBox width="55%" height="22px" rounded />
        <SkeletonBox width="40%" height="10px" rounded />
        <div class="flex items-end gap-[0.15rem] h-8 mt-auto">
          <SkeletonBox
            v-for="bar in 16"
            :key="bar"
            width="100%"
            :height="`${25 + ((bar * 19) % 60)}%`"
            rounded
          />
        </div>
      </div>
    </div>

    <!-- ════════ Breakdown Cards Skeleton ════════ -->
    <div class="grid grid-cols-3 gap-[0.875rem]">
      <div
        v-for="n in 3"
        :key="n"
        class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
      >
        <div
          class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
        >
          <SkeletonBox width="16px" height="16px" :custom-radius="'4px'" />
          <SkeletonBox width="110px" height="14px" rounded />
        </div>
        <div class="border-t border-[var(--o2-border-color)]" />
        <div class="px-[0.875rem] py-[0.5rem] flex flex-col">
          <div
            v-for="row in 3"
            :key="row"
            class="flex items-center gap-3 py-[9px] border-b border-[var(--o2-border-color)] last:border-b-0"
          >
            <SkeletonBox width="16px" height="16px" :custom-radius="'4px'" />
            <SkeletonBox width="70px" height="12px" rounded />
            <div
              class="flex-1 h-1.5 rounded-full"
              style="background: var(--o2-border-color); opacity: 0.3"
            />
            <SkeletonBox width="36px" height="12px" rounded />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SkeletonBox from "@/components/shared/SkeletonBox.vue";
</script>
