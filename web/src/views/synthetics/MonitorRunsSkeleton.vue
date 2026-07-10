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
        class="card-container rounded-lg flex flex-col px-[0.875rem] pt-[0.625rem] pb-[0.625rem] gap-2 bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)]"
      >
        <SkeletonBox width="60%" height="11px" rounded />
        <SkeletonBox width="55%" height="22px" rounded />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SkeletonBox from "@/components/shared/SkeletonBox.vue";
</script>
