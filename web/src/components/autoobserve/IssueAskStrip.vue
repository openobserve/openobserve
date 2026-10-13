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
  <!-- Stops clicks on the strip's padding from reaching the row, which would open the drawer. -->
  <div
    ref="rootEl"
    role="group"
    :aria-label="t('autoobserve.issues.proposalFor', { title })"
    class="rounded-default @container flex cursor-auto flex-wrap items-center gap-x-1.5 gap-y-1 border px-1 py-0.5 text-xs leading-5 whitespace-normal"
    :class="
      decided
        ? 'bg-surface-subtle border-border-subtle'
        : 'bg-badge-warning-soft-bg/40 border-badge-warning-ol-border/40'
    "
    :data-test="`autoobserve-issue-ask-${request.id}`"
    @click.stop
  >
    <span class="sr-only" role="status">{{ announcement }}</span>
    <template v-if="decided">
      <OIcon name="check-circle" size="xs" class="text-status-success-text shrink-0" />
      <span
        class="text-text-body min-w-0 flex-1"
        :data-test="`autoobserve-issue-ask-done-${request.id}`"
      >
        {{ doneText }}
      </span>
      <OButton
        variant="ghost-primary"
        size="xs"
        class="shrink-0"
        :data-test="`autoobserve-issue-ask-undo-${request.id}`"
        @click="onUndo"
      >
        {{ t("autoobserve2.needs.undo") }}
      </OButton>
    </template>
    <template v-else>
      <span
        class="inline-flex items-center gap-0.5"
        :title="`${t('autoobserve.issues.proposed')} · ${details}`"
      >
        <OIcon name="build" size="xs" class="text-status-warning-text me-0.5" aria-hidden="true" />
        <span class="sr-only">{{ t("autoobserve.issues.proposed") }}</span>
        <span class="text-text-secondary line-through">{{ t(entryKey("from")) }}</span>
        <OIcon name="arrow-forward" size="xs" class="text-text-muted" aria-hidden="true" />
        <span class="sr-only">{{ t("autoobserve2.needs.shiftTo") }}</span>
        <span class="text-text-heading font-semibold">{{ t(entryKey("to")) }}</span>
      </span>
      <!-- Narrow strips keep the details only in the tooltip and the buttons' description. -->
      <span aria-hidden="true" class="text-text-muted hidden @lg:inline">·</span>
      <span :id="detailsId" class="text-text-secondary sr-only @lg:not-sr-only">{{ details }}</span>
      <span class="ms-auto flex flex-wrap items-center gap-1">
        <OButton
          variant="primary"
          size="xs"
          :aria-describedby="detailsId"
          :data-test="`autoobserve-issue-ask-yes-${request.id}`"
          @click="onDecide('yes')"
        >
          {{ t(request.yes) }}
        </OButton>
        <OButton
          variant="ghost-muted"
          size="xs"
          :aria-describedby="detailsId"
          :data-test="`autoobserve-issue-ask-no-${request.id}`"
          @click="onDecide('no')"
        >
          {{ t(request.no) }}
        </OButton>
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useDecisions, type Decision } from "./v2/useDecisions";
import { say, type Request } from "./v2/fixtures";

const props = defineProps<{ request: Request; title: I18nText }>();

const { t } = useI18nTyped();

const { decisions, phases, decide, undo } = useDecisions();

const rootEl = ref<HTMLElement | null>(null);
const announcement = ref<I18nText>(raw(""));

const detailsId = useId();

const decided = computed(() => !!decisions[props.request.id]);

const copyKey = (part: string) =>
  `autoobserve2.needs.fixNow.${props.request.problem}.${part}` as I18nKey;

const entryKey = (part: string) =>
  `autoobserve2.activityPage.entries.${props.request.id}.${part}` as I18nKey;

const details = computed(() =>
  [t(entryKey("on")), t(copyKey("cost")), t("autoobserve.issues.reversible")].join(" · "),
);

const doneText = computed(() => {
  const { id, doneSettled, doneYes, doneNo } = props.request;
  const decision = decisions[id];
  if (!decision) return raw("");
  if (decision === "yes" && doneSettled && phases[id] === "fixed") return say(t, doneSettled);
  return say(t, decision === "yes" ? doneYes : doneNo);
});

// The pressed button unmounts with its state, so focus moves to its counterpart instead of falling to the page.
const focusAction = async (action: "undo" | "yes") => {
  await nextTick();
  rootEl.value
    ?.querySelector<HTMLElement>(
      `[data-test="autoobserve-issue-ask-${action}-${props.request.id}"]`,
    )
    ?.focus();
};

const onDecide = (decision: Decision) => {
  decide(props.request.id, decision);
  announcement.value = doneText.value;
  void focusAction("undo");
};

const onUndo = () => {
  undo(props.request.id);
  announcement.value = t("autoobserve2.needs.undone");
  void focusAction("yes");
};
</script>
