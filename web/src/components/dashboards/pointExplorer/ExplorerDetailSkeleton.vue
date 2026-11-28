<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Stands in for a sample's detail (its tab bar and JSON body) while its component is still loading. -->
<template>
  <div class="flex min-h-0 flex-1 flex-col" aria-busy="true" data-test="explorer-detail-loading">
    <div class="border-border-default flex shrink-0 items-center gap-2 border-b px-2 py-2">
      <div
        v-for="n in 4"
        :key="n"
        class="rounded-default bg-surface-subtle h-5 w-16 animate-pulse"
      />
    </div>
    <div class="flex flex-col gap-2 px-2 py-3">
      <div
        v-for="n in 6"
        :key="n"
        class="rounded-default bg-surface-subtle h-3 animate-pulse"
        :class="n % 2 ? 'w-3/4' : 'w-1/2'"
      />
    </div>
  </div>
</template>
