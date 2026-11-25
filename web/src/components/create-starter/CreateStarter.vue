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

<!-- The starter behind a New button: a menu of the ways to start; a picked way opens in a side panel. -->
<template>
  <span ref="anchorEl" class="inline-flex" data-test="create-starter-trigger">
    <slot :open="open" :toggle="toggle" />
    <!-- A zero-height strip on the bottom edge: anchoring above it turns the menu into a bottom sheet. -->
    <span
      v-if="isSheet"
      ref="sheetAnchor"
      class="pointer-events-none fixed inset-x-0 bottom-0 h-0"
      aria-hidden="true"
    />
    <OPopover
      :open="menuOpen"
      :anchor="isSheet ? sheetAnchor : anchorEl"
      :side="isSheet ? 'top' : 'bottom'"
      :align="isSheet ? 'center' : 'end'"
      :side-offset="isSheet ? 0 : 4"
      :hide-when-detached="!isSheet"
      flip-align
      :aria-label="title"
      content-class="flex w-[min(30rem,calc(100vw-1.5rem))] flex-col max-sm:rounded-b-none"
      @update:open="onMenuOpen"
      @open-auto-focus="focusMenuTitle"
      @pointer-down-outside="keepOpenForTrigger"
      @focus-outside="keepOpenForTrigger"
    >
      <OContent
        y
        class="flex flex-col gap-3"
        :data-pointer-moved="pointerMoved || undefined"
        data-test="create-starter-menu"
      >
        <span
          ref="menuTitleEl"
          tabindex="-1"
          class="text-dialog-header-text text-base font-semibold outline-none"
          data-test="create-starter-menu-title"
          >{{ title }}</span
        >
        <div v-if="$slots.resume" data-test="create-starter-resume">
          <slot name="resume" />
        </div>
        <StarterChoiceList
          :panes="listed"
          :form-label="formLabel"
          :form-description="formDescription"
          @pick="selectPane"
          @form="useForm"
        />
      </OContent>
    </OPopover>

    <ODrawer
      :open="panelOpen"
      size="lg"
      :aria-label="title"
      :return-focus-to="triggerButton"
      data-test="create-starter-panel"
      @update:open="onPanelOpen"
    >
      <template #header>
        <div class="flex min-h-8 min-w-0 items-center gap-2" data-test="create-starter-header">
          <span
            class="text-text-secondary inline-flex size-8 shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            <OIcon name="shield-alert-outline" size="sm" />
          </span>
          <span
            ref="titleEl"
            tabindex="-1"
            class="text-dialog-header-text shrink-0 text-base font-semibold outline-none"
            data-test="create-starter-title"
            >{{ title }}</span
          >
          <template v-if="activeLabel">
            <OIcon name="chevron-right" size="sm" class="text-text-secondary shrink-0" />
            <span
              class="text-text-body min-w-0 truncate text-base"
              data-test="create-starter-subtitle"
              >{{ activeLabel }}</span
            >
          </template>
          <template v-if="otherPane">
            <span class="flex-1" />
            <OButton
              variant="outline"
              size="sm"
              :icon-left="PANE_ICON[otherPane.id]"
              data-test="create-starter-switch"
              @click="selectPane(otherPane.id)"
              >{{ otherPane.label }}</OButton
            >
          </template>
        </div>
      </template>

      <div
        class="flex min-h-0 flex-col gap-3"
        :data-pointer-moved="pointerMoved || undefined"
        data-test="create-starter"
      >
        <!-- A visited pane stays mounted while hidden, so the switch never loses a draft or a running install. -->
        <div
          v-for="id in visited"
          v-show="activePane === id"
          :key="id"
          class="flex min-h-0 flex-col"
          :data-test="`create-starter-body-${id}`"
        >
          <slot v-if="id === 'ai'" name="pane-ai" />
          <slot v-else name="pane-library" />
        </div>
      </div>

      <template #footer>
        <!-- Its height is held in every state, so an action landing here never moves the frame. -->
        <div
          class="flex min-h-8.5 items-center justify-end gap-2"
          data-test="create-starter-footer"
        >
          <slot v-if="activePane" name="footer-end" :pane="activePane" />
        </div>
      </template>
    </ODrawer>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import StarterChoiceList from "@/components/create-starter/StarterChoiceList.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import type { I18nText } from "@/types/i18n";
import { PANE_ICON, type StarterPane } from "./createStarter.types";

type PaneId = StarterPane["id"];

// Below 40rem (640 px) the menu rises from the bottom edge instead of hanging off its button.
const SHEET_QUERY = "(max-width: 39.9375rem)";

const props = defineProps<{
  /** Listed in row order; a locked pane shows with its reason, a hidden one is left out. */
  panes: readonly StarterPane[];
  /** The last row, which leaves for the form. */
  formLabel: I18nText;
  formDescription: I18nText;
  /** The menu's and the panel's title. */
  title: I18nText;
}>();

const emit = defineEmits<{ "open-form": [] }>();

const open = defineModel<boolean>("open", { default: false });

const slots = defineSlots<{
  default?(props: { open: boolean; toggle: () => void }): unknown;
  "pane-ai"?(): unknown;
  "pane-library"?(): unknown;
  "footer-end"?(props: { pane: PaneId }): unknown;
  resume?(): unknown;
}>();

const anchorEl = ref<HTMLElement | null>(null);
const sheetAnchor = ref<HTMLElement | null>(null);
const titleEl = ref<HTMLElement | null>(null);
const menuTitleEl = ref<HTMLElement | null>(null);
const activePane = ref<PaneId | null>(null);
const visited = ref<PaneId[]>([]);
const isSheet = ref(false);
// A row that opens under a resting pointer shows no hover until the pointer moves.
const pointerMoved = ref(false);

const hasBody = (p: StarterPane) => !!slots[`pane-${p.id}`];
const listed = computed(() => props.panes.filter((p) => p.availability !== "hidden" && hasBody(p)));
const switchable = computed(() => listed.value.filter((p) => p.availability === "on"));
const activeLabel = computed(() => listed.value.find((p) => p.id === activePane.value)?.label);
const otherPane = computed(() =>
  switchable.value.find((p) => activePane.value && p.id !== activePane.value),
);
const menuOpen = computed(() => open.value && !activePane.value);
const panelOpen = computed(() => open.value && !!activePane.value);

const triggerButton = () =>
  anchorEl.value?.querySelector<HTMLElement>("[aria-haspopup]") ??
  anchorEl.value?.querySelector<HTMLElement>("button") ??
  null;

// The trigger lies outside the menu; its own click toggles, so the press must not close the menu first.
const keepOpenForTrigger = (event: Event) => {
  const original = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
  const target = (original?.target ?? event.target) as Node | null;
  if (target && anchorEl.value?.contains(target)) event.preventDefault();
};

// Picking a pane hides the menu and focuses the panel; that late dismiss must not close the panel.
const onMenuOpen = (next: boolean) => {
  if (!menuOpen.value || next) return;
  open.value = false;
  // A popover hung on a button has no trigger for the library to refocus, so Escape must not drop focus.
  nextTick(() => {
    const at = document.activeElement;
    if (!at || at === document.body || at.closest("[data-o-popover-content]"))
      triggerButton()?.focus();
  });
};

const onPanelOpen = (next: boolean) => {
  if (!next) open.value = false;
};

/** Always opens on the menu: nothing is picked until the user picks. */
const openStarter = () => {
  activePane.value = null;
  visited.value = [];
  open.value = true;
};

const toggle = () => {
  if (open.value) open.value = false;
  else openStarter();
};

const useForm = () => {
  open.value = false;
  emit("open-form");
};

// The switch removes the focused control, so focus lands on the title rather than dropping to the page.
const keepFocusInPanel = () =>
  nextTick(() => {
    const panel = titleEl.value?.closest("[data-o2-drawer]");
    const at = document.activeElement;
    if (!panel?.contains(at) || at === panel) titleEl.value?.focus();
  });

const selectPane = (id: PaneId) => {
  if (!switchable.value.some((p) => p.id === id)) return;
  activePane.value = id;
  if (!visited.value.includes(id)) visited.value = [...visited.value, id];
  keepFocusInPanel();
};

const cyclePane = () => {
  const list = switchable.value;
  if (list.length < 2) return;
  const at = list.findIndex((p) => p.id === activePane.value);
  selectPane(list[(at + 1) % list.length].id);
};

// The title takes focus, so no row shows a ring or a tooltip on open.
const focusMenuTitle = (event: Event) => {
  event.preventDefault();
  nextTick(() => menuTitleEl.value?.focus());
};

const notePointerMoved = () => {
  pointerMoved.value = true;
};

// Each menu and each pane opens under a resting pointer, so each waits for the pointer to move again.
watch([menuOpen, activePane], ([menu, pane]) => {
  window.removeEventListener("pointermove", notePointerMoved);
  pointerMoved.value = false;
  if (menu || pane) window.addEventListener("pointermove", notePointerMoved, { once: true });
});

let sheetMql: MediaQueryList | null = null;
const onSheetChange = (e: MediaQueryListEvent) => (isSheet.value = e.matches);
onMounted(() => {
  sheetMql = typeof window.matchMedia === "function" ? window.matchMedia(SHEET_QUERY) : null;
  if (!sheetMql) return;
  isSheet.value = sheetMql.matches;
  sheetMql.addEventListener?.("change", onSheetChange);
});
onBeforeUnmount(() => {
  sheetMql?.removeEventListener?.("change", onSheetChange);
  window.removeEventListener("pointermove", notePointerMoved);
});

useShortcuts([{ id: "createStarterSwitchPane", handler: cyclePane }], undefined, { active: open });

defineExpose({ openStarter });
</script>
