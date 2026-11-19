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

<!-- The starter under a New button: one switch of panes, a link to the form, and the remembered default. -->
<template>
  <span ref="anchorEl" class="inline-flex" data-test="create-starter-trigger">
    <slot :open="open" :starts-with-form="resolved === 'form'" :toggle="toggle" :start="start" />
    <!-- A zero-height strip on the bottom edge: anchoring above it turns the popover into a bottom sheet. -->
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
      flip-align
      :aria-label="opensWithLabel"
      content-class="flex w-[min(42.5rem,calc(100vw-1.5rem))] flex-col max-sm:rounded-b-none"
      @update:open="onOpenChange"
      @pointer-down-outside="keepOpenForTrigger"
      @focus-outside="keepOpenForTrigger"
    >
      <div class="flex min-h-0 flex-col" data-test="create-starter">
        <div
          class="border-border-default flex flex-wrap items-center gap-x-3 gap-y-2 border-b p-3"
          data-test="create-starter-switch-row"
        >
          <OTooltip
            v-if="switchable.length"
            :content="t('createStarter.switchHint')"
            shortcut-id="createStarterSwitchPane"
            :disabled="switchable.length < 2"
          >
            <OToggleGroup :model-value="activePane ?? undefined" @update:model-value="selectPane">
              <OToggleGroupItem
                v-for="pane in switchable"
                :key="pane.id"
                :value="pane.id"
                size="sm"
                :icon-left="PANE_ICON[pane.id]"
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
            v-if="switchable.length"
            class="bg-border-default h-5 w-px shrink-0"
            aria-hidden="true"
          />
          <OButton
            variant="ghost"
            size="sm"
            icon-right="arrow-forward"
            data-test="create-starter-use-form"
            @click="useForm"
            >{{ formLabel }}</OButton
          >
        </div>
        <div v-if="$slots.resume" class="px-3 pt-2" data-test="create-starter-resume">
          <slot name="resume" />
        </div>
        <div
          v-if="activePane"
          class="max-h-[60vh] min-h-0 flex-1 overflow-y-auto"
          :data-test="`create-starter-body-${activePane}`"
        >
          <slot v-if="activePane === 'ai'" name="pane-ai" />
          <slot v-else name="pane-library" />
        </div>
        <div
          class="border-border-default flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2"
          data-test="create-starter-footer"
        >
          <StartWithSelect
            :model-value="pref.def.value"
            :label="opensWithLabel"
            :choices="choices"
            :last-now="lastNow"
            :opens-now="resolved"
            @update:model-value="pref.setDefault"
          />
          <div class="flex items-center gap-2">
            <slot name="footer-end" />
          </div>
        </div>
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
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import StartWithSelect, { type StartWithChoice } from "./StartWithSelect.vue";
import { resolveStart, useStartPreference, type StartCandidate } from "./useStartPreference";
import type { StartChoice, StarterKind, StarterPane } from "./createStarter.types";

type PaneId = StarterPane["id"];

const PANE_ICON = { ai: "auto-awesome", library: "menu-book" } as const;
// Below 40rem (640 px) the starter rises from the bottom edge instead of hanging off its button.
const SHEET_QUERY = "(max-width: 39.9375rem)";

const props = defineProps<{
  kind: StarterKind;
  panes: readonly StarterPane[];
  /** The link beside the switch: "Use the form". */
  formLabel: I18nText;
  /** The form as a default in the footer menu: "The form". */
  formChoiceLabel: I18nText;
  /** The footer line: "New alert opens with". */
  opensWithLabel: I18nText;
}>();

const emit = defineEmits<{
  "open-form": [];
  "pane-change": [PaneId];
}>();

const open = defineModel<boolean>("open", { default: false });

const slots = defineSlots<{
  default?(props: {
    open: boolean;
    startsWithForm: boolean;
    toggle: () => void;
    start: () => void;
  }): unknown;
  "pane-ai"?(): unknown;
  "pane-library"?(): unknown;
  "footer-end"?(): unknown;
  resume?(): unknown;
}>();
const { t, locale } = useI18nTyped();
const pref = useStartPreference(props.kind);

const anchorEl = ref<HTMLElement | null>(null);
const sheetAnchor = ref<HTMLElement | null>(null);
const activePane = ref<PaneId | null>(null);

// A pane is offered only when it is on AND its host gave it a body to show.
const openable = (p: StarterPane) => p.availability === "on" && !!slots[`pane-${p.id}`];
const switchable = computed(() => props.panes.filter(openable));
const candidates = computed<StartCandidate[]>(() =>
  props.panes.map((p) => ({ id: p.id, openable: openable(p), count: p.count })),
);
const resolved = computed(() => resolveStart(pref.def.value, pref.last.value, candidates.value));
const lastNow = computed(() => resolveStart("last", pref.last.value, candidates.value));
const choices = computed<StartWithChoice[]>(() => [
  ...props.panes.map((p) => ({
    value: p.id,
    label: p.label,
    state: openable(p)
      ? ("on" as const)
      : p.availability === "locked"
        ? ("locked" as const)
        : ("hidden" as const),
  })),
  { value: "form", label: props.formChoiceLabel, state: "on" },
]);

const formatCount = (n: number) => new Intl.NumberFormat(locale.value).format(n);

const isPane = (c: StartChoice): c is PaneId => c !== "form";

const openStarter = (pane?: PaneId) => {
  const first = resolved.value;
  const fromDefault = isPane(first) && switchable.value.some((p) => p.id === first) ? first : null;
  activePane.value = pane ?? fromDefault ?? switchable.value[0]?.id ?? null;
  open.value = true;
};

const close = () => onOpenChange(false);

const toggle = () => (open.value ? close() : openStarter());

const useForm = () => {
  pref.recordUse("form");
  close();
  emit("open-form");
};

/** What New does: the form straight away when that is how it opens, else the starter. */
const start = () => (resolved.value === "form" ? useForm() : openStarter());

const selectPane = (v: unknown) => {
  const pane = switchable.value.find((p) => p.id === v);
  if (!pane) return;
  activePane.value = pane.id;
  emit("pane-change", pane.id);
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

defineExpose({ start, openStarter, toggle, close, resolved });
</script>
