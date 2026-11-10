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
  <div
    v-if="tail"
    ref="mirror"
    aria-hidden="true"
    class="pointer-events-none absolute overflow-hidden px-1 py-0 text-sm leading-6 wrap-break-word whitespace-pre-wrap text-transparent"
    :style="box"
    data-test="assistant-dictate-tail"
  >
    {{ before
    }}<span class="bg-input-bg text-text-muted" data-test="assistant-dictate-interim">{{
      tail
    }}</span>
  </div>
</template>

<script lang="ts">
export interface AssistantDictationTailProps {
  field: HTMLTextAreaElement | null;
  /** The draft up to where the tail shows. */
  before: string;
  tail: string;
}
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch, type CSSProperties } from "vue";

const props = defineProps<AssistantDictationTailProps>();

const mirror = ref<HTMLElement | null>(null);
const box = ref<CSSProperties>({});

// A textarea cannot style a range, so an exact copy over it masks the unsettled words and redraws them muted.
function measure(): void {
  const { field } = props;
  const parent = mirror.value?.offsetParent;
  if (!field || !parent) return;
  const outer = parent.getBoundingClientRect();
  const inner = field.getBoundingClientRect();
  box.value = {
    top: `${inner.top - outer.top}px`,
    left: `${inner.left - outer.left}px`,
    width: `${field.clientWidth}px`,
    height: `${field.clientHeight}px`,
  };
  mirror.value!.scrollTop = field.scrollTop;
}

function onScroll(): void {
  if (mirror.value && props.field) mirror.value.scrollTop = props.field.scrollTop;
}

watch(
  () => props.field,
  (field, previous) => {
    previous?.removeEventListener("scroll", onScroll);
    field?.addEventListener("scroll", onScroll);
  },
  { immediate: true },
);
watch(
  () => [props.before, props.tail],
  () => void nextTick(measure),
  { immediate: true },
);

onBeforeUnmount(() => props.field?.removeEventListener("scroll", onScroll));
</script>
