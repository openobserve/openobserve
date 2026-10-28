<!--
Copyright 2026 OpenObserve Inc.

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
  <!-- A button's children are presentational, so the corner dot's meaning lives in the button's own name; the tooltip shows it. -->
  <span
    v-if="corner"
    ref="dotRef"
    class="bg-button-pending-bg ring-button-pending-bg/30 pointer-events-none absolute -end-1 -top-1 size-2.5 rounded-full ring-4"
    aria-hidden="true"
    :data-test="dataTest"
  >
    <OTooltip
      v-if="host && tooltip"
      :anchor="host"
      :open="hostActive"
      :content="label"
      side="bottom"
      @update:open="hostActive = $event"
    />
  </span>
  <OTooltip v-else :content="label" side="right">
    <span
      role="img"
      :aria-label="label"
      class="bg-button-pending-bg ring-button-pending-bg/30 inline-block size-2 shrink-0 rounded-full ring-2"
      :data-test="dataTest"
    />
  </OTooltip>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { formatEditorDraftTime } from "@/utils/drafts/editorDraftStore";

const props = withDefaults(
  defineProps<{
    /** When the row's draft was written; the inline dot's tooltip shows it. */
    savedAt?: number | null;
    /** Pins the dot to the top-end corner of a positioned parent such as an OButton. */
    corner?: boolean;
    /** Off when the host button already has a tooltip that says it has a draft. */
    tooltip?: boolean;
    dataTest?: string;
  }>(),
  { savedAt: null, corner: false, tooltip: true, dataTest: "editor-draft-dot" },
);

const { t, locale } = useI18nTyped();
const store = useStore();

const label = computed(() =>
  props.savedAt === null
    ? t("common.editorDraft.dotUndated")
    : t("common.editorDraft.rowDot", {
        date: formatEditorDraftTime(props.savedAt, locale.value, store.state.timezone || undefined),
      }),
);

// The dot cannot be hovered, so its tooltip opens on the host button's own hover and focus.
const HOVER_DELAY_MS = 700;
const HOST_SELECTOR = "button, a[href], [role='button']";

const dotRef = ref<HTMLElement | null>(null);
const host = shallowRef<HTMLElement | null>(null);
const hostActive = ref(false);
let showTimer: ReturnType<typeof setTimeout> | null = null;

// A dot CSS hides (e.g. `md:hidden`) has no box, and a tooltip for a dot nobody sees would point at nothing.
const dotVisible = () => !!dotRef.value?.getClientRects().length;

const show = () => {
  if (showTimer) clearTimeout(showTimer);
  if (!props.tooltip || !dotVisible()) return;
  showTimer = setTimeout(() => {
    if (props.tooltip && dotVisible()) hostActive.value = true;
  }, HOVER_DELAY_MS);
};

const hide = () => {
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  hostActive.value = false;
};

const HOST_EVENTS = [
  ["mouseenter", show],
  ["focusin", show],
  ["mouseleave", hide],
  ["focusout", hide],
] as const;

// The host may turn its own tooltip on and off (e.g. a cap message), so this one follows the prop live.
watch(
  () => props.tooltip,
  (on) => {
    if (!on) hide();
  },
);

onMounted(() => {
  if (!props.corner) return;
  host.value = dotRef.value?.parentElement?.closest<HTMLElement>(HOST_SELECTOR) ?? null;
  HOST_EVENTS.forEach(([name, handler]) => host.value?.addEventListener(name, handler));
});

onBeforeUnmount(() => {
  hide();
  HOST_EVENTS.forEach(([name, handler]) => host.value?.removeEventListener(name, handler));
});
</script>
