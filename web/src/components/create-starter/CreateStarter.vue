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

<!-- The starter under a New button: one row of ways to start, nothing picked until the user picks. -->
<template>
  <span ref="anchorEl" class="inline-flex" data-test="create-starter-trigger">
    <slot :open="open" :toggle="toggle" />
    <!-- A zero-height strip on the bottom edge: anchoring above it turns the popover into a bottom sheet.
         The positioner counts a zero-height anchor as detached, so the sheet never hides on that. -->
    <span
      v-if="isSheet"
      ref="sheetAnchor"
      class="pointer-events-none fixed inset-x-0 bottom-0 h-0"
      aria-hidden="true"
    />
    <OPopover
      :open="open"
      :anchor="isSheet ? sheetAnchor : anchorEl"
      :side="isSheet ? 'top' : 'bottom'"
      :align="isSheet ? 'center' : 'end'"
      :side-offset="isSheet ? 0 : 4"
      :hide-when-detached="!isSheet"
      flip-align
      :aria-label="label"
      content-class="flex w-[min(42.5rem,calc(100vw-1.5rem))] flex-col max-sm:rounded-b-none"
      @update:open="onOpenChange"
      @pointer-down-outside="keepOpenForTrigger"
      @focus-outside="keepOpenForTrigger"
    >
      <div class="flex min-h-0 flex-col" data-test="create-starter">
        <OContent
          class="border-border-default flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
          :class="{ 'border-b': activePane || $slots.resume }"
          data-test="create-starter-switch-row"
        >
          <OTooltip
            v-if="listed.length"
            :content="t('createStarter.switchHint')"
            shortcut-id="createStarterSwitchPane"
            :disabled="switchable.length < 2"
          >
            <OToggleGroup :model-value="activePane" @update:model-value="selectPane">
              <OToggleGroupItem
                v-for="pane in listed"
                :key="pane.id"
                :value="pane.id"
                size="sm"
                :icon-left="pane.availability === 'locked' ? 'lock' : PANE_ICON[pane.id]"
                :disabled="pane.availability === 'locked'"
                :focusable-unavailable="pane.availability === 'locked'"
                :tooltip="pane.availability === 'locked' ? pane.lockedReason : undefined"
                :data-test="`create-starter-pane-${pane.id}`"
              >
                {{ pane.label }}
                <span
                  v-if="pane.count"
                  class="text-text-secondary ms-1.5 text-xs font-normal tabular-nums"
                  :data-test="`create-starter-pane-${pane.id}-count`"
                  >{{
                    t("createStarter.matchCount", { count: formatCount(pane.count) }, pane.count)
                  }}</span
                >
              </OToggleGroupItem>
            </OToggleGroup>
          </OTooltip>
          <span
            v-if="listed.length"
            class="bg-border-default h-5 w-px shrink-0 max-sm:hidden"
            aria-hidden="true"
          />
          <OButton
            variant="ghost-primary"
            size="sm"
            icon-right="arrow-forward"
            data-test="create-starter-use-form"
            @click="useForm"
            >{{ formLabel }}</OButton
          >
        </OContent>
        <OContent v-if="$slots.resume" class="pt-2" data-test="create-starter-resume">
          <slot name="resume" />
        </OContent>
        <OContent
          v-if="activePane"
          y
          class="flex max-h-[60vh] min-h-0 flex-1 flex-col overflow-y-auto"
          :data-test="`create-starter-body-${activePane}`"
        >
          <slot v-if="activePane === 'ai'" name="pane-ai" />
          <slot v-else name="pane-library" />
        </OContent>
        <OContent
          v-if="activePane"
          class="border-border-default flex items-center justify-end gap-2 border-t py-2"
          data-test="create-starter-footer"
        >
          <!-- Holds a small button's height, so an action landing here never grows the footer. -->
          <div class="flex min-h-8.5 items-center gap-2">
            <slot name="footer-end" :pane="activePane" />
          </div>
        </OContent>
      </div>
    </OPopover>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { StarterPane } from "./createStarter.types";

type PaneId = StarterPane["id"];

const PANE_ICON = { ai: "auto-awesome", library: "menu-book" } as const;
// Below 40rem (640 px) the starter rises from the bottom edge instead of hanging off its button.
const SHEET_QUERY = "(max-width: 39.9375rem)";

const props = defineProps<{
  /** Listed in row order; a locked pane shows with its reason, a hidden one is left out. */
  panes: readonly StarterPane[];
  /** The link after the switch: "Use the form". */
  formLabel: I18nText;
  /** The popover's accessible name. */
  label: I18nText;
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
const { t, locale } = useI18nTyped();

const anchorEl = ref<HTMLElement | null>(null);
const sheetAnchor = ref<HTMLElement | null>(null);
// null, not undefined: the toggle group stays controlled, so clicking the picked item never clears it.
const activePane = ref<PaneId | null>(null);

const hasBody = (p: StarterPane) => !!slots[`pane-${p.id}`];
const listed = computed(() => props.panes.filter((p) => p.availability !== "hidden" && hasBody(p)));
const switchable = computed(() => listed.value.filter((p) => p.availability === "on"));

const formatCount = (n: number) => new Intl.NumberFormat(locale.value).format(n);

/** Always opens on the row alone: nothing is picked until the user picks. */
const openStarter = () => {
  activePane.value = null;
  open.value = true;
};

const close = () => onOpenChange(false);

const toggle = () => (open.value ? close() : openStarter());

const useForm = () => {
  close();
  emit("open-form");
};

const selectPane = (v: unknown) => {
  const pane = switchable.value.find((p) => p.id === v);
  if (pane) activePane.value = pane.id;
};

const cyclePane = () => {
  const list = switchable.value;
  if (list.length < 2) return;
  const at = list.findIndex((p) => p.id === activePane.value);
  selectPane(list[(at + 1) % list.length].id);
};

const onOpenChange = (next: boolean) => {
  open.value = next;
  if (next) return;
  // Anchored popovers have no trigger for the library to refocus; a keyboard close must not drop focus.
  nextTick(() => {
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest("[data-o-popover-content]")) return;
    const el = anchorEl.value;
    (
      el?.querySelector<HTMLElement>("[aria-haspopup]") ?? el?.querySelector<HTMLElement>("button")
    )?.focus();
  });
};

// The trigger lies outside the content; its own click toggles, so the press must not close first.
const keepOpenForTrigger = (event: Event) => {
  const original = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
  const target = (original?.target ?? event.target) as Node | null;
  if (target && anchorEl.value?.contains(target)) event.preventDefault();
};

useShortcuts([{ id: "createStarterSwitchPane", handler: cyclePane }], undefined, { active: open });

const isSheet = ref(false);
let sheetMql: MediaQueryList | null = null;
const onSheetChange = (e: MediaQueryListEvent) => (isSheet.value = e.matches);
onMounted(() => {
  sheetMql = typeof window.matchMedia === "function" ? window.matchMedia(SHEET_QUERY) : null;
  if (!sheetMql) return;
  isSheet.value = sheetMql.matches;
  sheetMql.addEventListener?.("change", onSheetChange);
});
onBeforeUnmount(() => sheetMql?.removeEventListener?.("change", onSheetChange));

defineExpose({ openStarter });
</script>
