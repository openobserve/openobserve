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
    v-model:open="open"
    :side="placement.side"
    align="start"
    :side-offset="placement.offset"
    content-class="w-[min(26rem,calc(100vw-1.5rem))]"
    :aria-label="t('autoresolve.correctionsUsed.title')"
  >
    <template #trigger>
      <OButton
        ref="chip"
        variant="outline"
        size="chip"
        icon-left="history"
        icon-right="expand-more"
        :aria-expanded="open"
        data-test="autoresolve-corrections-used"
        v-bind="$attrs"
      >
        {{
          t("autoresolve.correctionsUsed.chip", { count: corrections.length }, corrections.length)
        }}
      </OButton>
    </template>
    <div class="flex flex-col gap-3 p-3" data-test="autoresolve-corrections-used-list">
      <h3 class="text-text-heading m-0 text-sm font-semibold">
        {{ t("autoresolve.correctionsUsed.title") }}
      </h3>
      <ul class="m-0 flex list-none flex-col gap-2.5 p-0">
        <li
          v-for="(correction, idx) in shown"
          :key="`${correction.created_at_us}-${idx}`"
          class="flex min-w-0 flex-col gap-1"
          data-test="autoresolve-corrections-used-row"
        >
          <span class="flex min-w-0 items-start gap-2">
            <OTag
              type="autoresolveCorrectionKind"
              :value="correction.kind"
              size="sm"
              class="shrink-0"
            />
            <span class="text-text-body text-compact min-w-0 wrap-anywhere">{{
              correction.note
            }}</span>
          </span>
          <span class="text-text-secondary text-xs">{{ source(correction) }}</span>
        </li>
      </ul>
      <p
        v-if="hidden"
        class="text-text-secondary m-0 text-xs"
        data-test="autoresolve-corrections-used-more"
      >
        {{ andMoreText(hidden, t) }}
      </p>
      <router-link
        v-if="autoresolve"
        :to="{
          name: 'autoresolveSaved',
          params: { id: autoresolve.id },
          query: { org_identifier: orgId },
        }"
        class="text-text-link text-xs font-semibold hover:underline"
        data-test="autoresolve-corrections-used-manage"
      >
        {{ t("autoresolve.correctionsUsed.manage") }}
      </router-link>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch, type ComponentPublicInstance } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import useBreakpoint from "@/composables/useBreakpoint";
import type { AutoResolveCorrectionUsed } from "@/services/autoresolve";
import { raw, useI18nTyped } from "@/types/i18n";
import { andMoreText, autoresolveTime } from "@/utils/autoresolve/autoresolveText";

const SHOWN = 3;
const WIDTH_REM = 26;
const GAP = 12;
const BELOW = { side: "bottom", offset: 4 } as const;

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  corrections: AutoResolveCorrectionUsed[];
  /** The saved AutoResolve that keeps the corrections; null for a run from the goal box. */
  autoresolve: { id: string; name: string } | null;
  /** The option cards: the popover opens right of the last one when the page has room, else below them. */
  options?: () => Element[];
}>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const open = ref(false);
const { isMobile } = useBreakpoint();

const chip = ref<ComponentPublicInstance | null>(null);
const placement = ref<{ side: "bottom" | "right"; offset: number }>({ ...BELOW });
const placeClear = () => {
  const chipEl = chip.value?.$el;
  const cards = props.options?.() ?? [];
  if (isMobile.value || !(chipEl instanceof Element) || !cards.length) return { ...BELOW };
  const chipBox = chipEl.getBoundingClientRect();
  const boxes = cards.map((card) => card.getBoundingClientRect());
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  if (right > chipBox.right && window.innerWidth - right - GAP >= WIDTH_REM * remPx) {
    return { side: "right" as const, offset: right - chipBox.right + GAP };
  }
  return { side: "bottom" as const, offset: Math.max(BELOW.offset, bottom - chipBox.bottom + GAP) };
};
watch(open, (now) => {
  if (now) placement.value = placeClear();
});

const shown = computed(() => props.corrections.slice(0, SHOWN));
const hidden = computed(() => Math.max(0, props.corrections.length - SHOWN));

const source = (c: AutoResolveCorrectionUsed) => {
  const params = {
    name: raw(c.created_by),
    time: autoresolveTime(c.created_at_us, "MMM d, HH:mm"),
  };
  return c.this_run
    ? t("autoresolve.correctionsUsed.thisRun", params)
    : t("autoresolve.correctionsUsed.earlierRun", params);
};
</script>
