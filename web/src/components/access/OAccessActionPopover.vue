<!-- Copyright 2026 OpenObserve Inc.

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
  <OPopover
    :open="!!actionNotice"
    :anchor="actionNotice?.el ?? null"
    side="bottom"
    align="end"
    flip-align
    arrow
    :side-offset="-1"
    :collision-padding="8"
    content-class="border-0!"
    @update:open="onOpenChange"
    @open-auto-focus="keepFocus"
  >
    <OAccessDeniedCard :denials="denials" role="alert" data-test="access-action-error" />
    <template #arrow>
      <path class="fill-dropdown-bg" d="M0 0L6 6L12 0Z" />
      <path class="fill-banner-error-soft-bg" d="M0 0L6 6L12 0Z" />
      <path class="stroke-banner-error-soft-border fill-none" d="M0 0L6 6L12 0" />
    </template>
  </OPopover>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OAccessDeniedCard from "@/components/access/OAccessDeniedCard.vue";
import { useAccessBoundary, type AccessDenial } from "@/composables/useAccessStore";

const { actionNotice, dismissAction } = useAccessBoundary();

const denials = computed<AccessDenial[]>(() => {
  const notice = actionNotice.value;
  if (!notice) return [];
  const request = `${notice.method} ${notice.resource.path}`;
  return [{ resource: notice.resource, permission: notice.permission, requests: [request] }];
});

function onOpenChange(open: boolean): void {
  if (!open) dismissAction();
}

// The control the user just pressed keeps focus; the error is announced through role="alert".
function keepFocus(event: Event): void {
  event.preventDefault();
}
</script>
