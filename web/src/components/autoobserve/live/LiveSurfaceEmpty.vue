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
  <LiveNoticeState
    :notice="view.notice"
    size="block"
    :action="view.action"
    :data-test="`autoobserve-live-empty-${surface}`"
    @action="emit('action')"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import LiveNoticeState from "./LiveNoticeState.vue";
import { liveSurfaceEmpty, type LiveEmptySurface } from "./liveCopy";

const props = defineProps<{ surface: LiveEmptySurface }>();

const emit = defineEmits<{ action: [] }>();

const { t } = useI18nTyped();

const view = computed(() => liveSurfaceEmpty(t, props.surface));
</script>
