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

<!--
  Shared "Add next step" picker (Pipelines + Workflows) — a searchable popover
  opened by clicking a node's source handle (or the empty-canvas start node).
  Purely presentational: each editor passes the addable `items` and handles the
  chosen one.

  ANCHORED, NOT MODAL. It used to be a centred ODialog, which pulled the eye
  away from the node being extended and dimmed the graph you were reasoning
  about. It now opens AT the click, so the choice happens where the work is.
  `anchor` is a viewport point (usually the click coords); with none it falls
  back to screen-centred, so a caller that has no sensible point still works.

  Positioning is inline `--sp-x` / `--sp-y` custom properties rather than
  utilities — the coordinates are runtime values, so no class can express them
  (same pattern as CustomNode's `--node-color`).

    items[] = {
      key          — unique id (also the data-test suffix)
      title        — bold label (searched)
      description  — sub-label (searched)
      icon         — OIcon name, or "img:<url>"
      iconTint     — Tailwind classes for the icon square
      ...extra     — anything the host needs back on pick (echoed in @pick)
    }

  Emits `pick(item)` when a row is clicked and `close` when dismissed
  (outside click or Escape).
-->
<template>
  <Teleport to="body">
    <!-- Transparent click-catcher: dismisses on outside click without dimming
         the canvas, so the graph stays readable while choosing. -->
    <div class="fixed inset-0 z-6000" :data-test="testPrefix + '-backdrop'" @click="emit('close')">
      <div
        class="rounded-surface border-border-default bg-card-bg absolute top-[var(--sp-y)] left-[var(--sp-x)] flex max-h-96 w-80 flex-col overflow-hidden border shadow-[0_0.5rem_1.5rem_color-mix(in_srgb,var(--color-black)_18%,transparent)]"
        :style="{ '--sp-x': panelX + 'px', '--sp-y': panelY + 'px' }"
        :data-test="testPrefix + '-dialog'"
        @click.stop
      >
        <div class="shrink-0 p-2">
          <OSearchInput
            ref="searchRef"
            v-model="search"
            :placeholder="placeholderText"
            clearable
            class="w-full"
            :data-test="testPrefix + '-search'"
          />
        </div>

        <div
          v-if="filtered.length"
          class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 pt-0"
        >
          <button
            v-for="item in filtered"
            :key="item.key"
            type="button"
            class="flow-step-card rounded-default flex cursor-pointer items-center gap-2.5 bg-transparent p-2 text-left transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--color-primary-600)_8%,transparent)]"
            :data-test="`${testPrefix}-${item.key}`"
            @click="emit('pick', item)"
          >
            <div
              class="rounded-default inline-flex h-7 w-7 shrink-0 items-center justify-center"
              :class="item.iconTint"
            >
              <OIcon :name="item.icon || 'help'" size="sm" />
            </div>
            <div class="min-w-0">
              <div class="text-text-body text-sm font-semibold">
                {{ item.title }}
              </div>
              <div v-if="item.description" class="text-text-secondary text-xs leading-snug">
                {{ item.description }}
              </div>
            </div>
          </button>
        </div>

        <div v-else class="text-text-secondary py-8 text-center text-sm">
          {{ emptyText }}
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";

interface StepItem {
  key: string;
  title: string;
  description?: string;
  icon?: string;
  iconTint?: string;
  [k: string]: any;
}

const props = withDefaults(
  defineProps<{
    items: StepItem[];
    searchPlaceholder?: string;
    noMatchText?: string;
    testPrefix?: string;
    /** Viewport point to open at (usually the click). Null = screen-centred. */
    anchor?: { x: number; y: number } | null;
  }>(),
  {
    anchor: null,
    // Empty, not English: t() cannot run at module scope (no setup context), so
    // the locale fallback lives in the computeds below. A caller may still pass
    // its own already-translated string.
    searchPlaceholder: "",
    noMatchText: "",
    testPrefix: "flow-step",
  },
);

const emit = defineEmits<{
  (e: "pick", item: StepItem): void;
  (e: "close"): void;
}>();

const { t } = useI18n();

const placeholderText = computed(() => props.searchPlaceholder || (t("common.search") as string));
const emptyText = computed(() => props.noMatchText || (t("common.noMatches") as string));

// Panel box, kept in sync with the `w-80` / `max-h-96` utilities on it. Used to
// keep the panel inside the viewport; measuring instead would need a render
// pass first, which would show the panel in the wrong place for one frame.
const PANEL_W = 320;
const PANEL_H = 384;
const GAP = 8;

// Clamp so a click near an edge still opens a fully visible panel; if there is
// no room below the click, flip above it rather than overflow the bottom.
const panelX = computed(() => {
  const x = props.anchor?.x ?? (window.innerWidth - PANEL_W) / 2;
  return Math.max(GAP, Math.min(x, window.innerWidth - PANEL_W - GAP));
});

const panelY = computed(() => {
  if (!props.anchor) return Math.max(GAP, (window.innerHeight - PANEL_H) / 2);
  const below = props.anchor.y + GAP;
  const flipped = props.anchor.y - PANEL_H - GAP;
  const y = below + PANEL_H > window.innerHeight && flipped > GAP ? flipped : below;
  return Math.max(GAP, Math.min(y, window.innerHeight - PANEL_H - GAP));
});

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") emit("close");
};
onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));

const search = ref("");
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.items;
  return props.items.filter(
    (it) =>
      (it.title || "").toLowerCase().includes(q) ||
      (it.description || "").toLowerCase().includes(q),
  );
});
</script>
