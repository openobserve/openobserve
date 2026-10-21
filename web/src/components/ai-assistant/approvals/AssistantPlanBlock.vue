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
    v-if="card"
    role="group"
    :aria-labelledby="headingId"
    class="flex min-w-0 flex-col gap-1.5"
    data-test="assistant-plan-block"
  >
    <OText :id="headingId" variant="body-strong" as="p">{{ heading }}</OText>
    <ul ref="list" class="flex min-w-0 flex-col" :aria-label="t('assistant.plan.itemsName')">
      <li
        v-for="item in shown"
        :key="item.key"
        class="flex min-w-0 items-center gap-2 max-md:min-h-11 pointer-coarse:min-h-11"
        :data-test="`assistant-plan-item-${item.key}`"
      >
        <!-- A click on the tick mark would reach the wrapping label too and toggle twice; the box itself takes it -->
        <OCheckbox
          v-if="editable"
          :model-value="selected.includes(item.key)"
          :label="item.label"
          :disabled="disabled"
          class="min-w-0 flex-1 break-words [&_[role=checkbox]_*]:pointer-events-none"
          @update:model-value="(on) => toggle(item.key, on === true)"
        />
        <OText v-else as="span" class="min-w-0 flex-1 break-words">{{ item.label }}</OText>
        <OButton
          v-if="item.href"
          variant="ghost-primary"
          size="xs"
          as="a"
          :href="item.href"
          target="_blank"
          rel="noopener noreferrer"
          :icon-right="assistantGlyph.newTab"
          :aria-label="t('assistant.approval.result.open', { name: item.label })"
          :class="['shrink-0', TOUCH_TARGET_CLASS]"
          :data-test="`assistant-plan-item-open-${item.key}`"
        >
          {{ t("assistant.approval.open") }}
        </OButton>
      </li>
    </ul>
    <OButton
      v-if="hidden > 0"
      variant="ghost"
      size="sm"
      :class="['self-start', TOUCH_TARGET_CLASS]"
      data-test="assistant-plan-show-all"
      @click="showAll"
    >
      {{ t("assistant.plan.showAll", { count: items.length }) }}
    </OButton>
    <OText v-if="unlisted > 0" variant="meta" as="p" data-test="assistant-plan-unlisted">
      {{ t("assistant.plan.unlisted", { count: unlisted }, unlisted) }}
    </OText>
    <OText v-if="editable" variant="meta" as="p">{{ t("assistant.plan.deselectHint") }}</OText>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  approvalEntity,
  approvalTargetHref,
  type ApprovalBlockData,
  type AssistantTurnView,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { ContentBlock } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

/** Above this many items the plan lists the first ones and offers the rest. */
const PLAN_ROWS = 20;

const props = withDefaults(
  defineProps<{
    /** The card it plans; a registered `plan` block passes its own. */
    card?: ApprovalBlockData | null;
    block?: ContentBlock | null;
    /** The kept items' keys (`id`, else the name). */
    selected?: string[];
    editable?: boolean;
    /** The decision is on its way: the boxes stay, unavailable. */
    disabled?: boolean;
    org?: string;
    blockId?: string;
    density?: "compact" | "roomy";
    readonly?: boolean;
    message?: unknown;
    turn?: AssistantTurnView | null;
  }>(),
  {
    card: null,
    block: null,
    selected: () => [],
    editable: false,
    disabled: false,
    org: "",
    blockId: "",
    density: "compact",
    readonly: false,
    turn: null,
  },
);

const emit = defineEmits<{ (e: "update:selected", keys: string[]): void }>();

const { t } = useI18nTyped();
const router = useRouter();
const headingId = `assistant-plan-${useId()}`;
const all = ref(false);
const list = ref<HTMLElement | null>(null);

const card = computed(() => props.card ?? props.block?.approval ?? null);

const items = computed(() =>
  (card.value?.targets ?? []).map((target) => ({
    key: target.id ?? target.name,
    label: raw(target.name) as I18nText,
    href: target.id ? approvalTargetHref(router, props.org || props.turn?.org || "", target) : null,
  })),
);

const shown = computed(() => (all.value ? items.value : items.value.slice(0, PLAN_ROWS)));
const hidden = computed(() => items.value.length - shown.value.length);
const unlisted = computed(() => Math.max(0, (card.value?.total ?? 0) - items.value.length));

const heading = computed(() => {
  const count = card.value?.total ?? items.value.length;
  const entity = t(`assistant.entity.${approvalEntity(card.value ?? { targets: [] })}`, count);
  return t("assistant.plan.heading", { count, entity });
});

function toggle(key: string, on: boolean): void {
  const kept = new Set(props.selected);
  if (on) kept.add(key);
  else kept.delete(key);
  emit(
    "update:selected",
    items.value.map((item) => item.key).filter((k) => kept.has(k)),
  );
}

// Show all goes away, so focus moves to the first row it revealed.
async function showAll(): Promise<void> {
  all.value = true;
  await nextTick();
  list.value?.children[PLAN_ROWS]?.querySelector<HTMLElement>("button, input, a")?.focus();
}
</script>
