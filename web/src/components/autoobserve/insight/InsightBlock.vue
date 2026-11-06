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
  <component
    :is="card ? 'article' : 'div'"
    class="flex flex-col"
    :class="
      card
        ? 'rounded-default bg-surface-base border-border-subtle relative gap-2 overflow-hidden border py-3.5 ps-4 pe-3.5 shadow-xs'
        : 'gap-3 px-4 py-3'
    "
    :data-test="`insight-block-${parts.id}`"
  >
    <template v-if="card">
      <span
        class="absolute inset-y-0 start-0 w-1"
        :class="ACCENT[parts.chip.tone]"
        aria-hidden="true"
      />
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <OTag
          :variant="parts.chip.variant"
          size="xs"
          :label="parts.chip.label"
          :data-test="`insight-block-${parts.id}-chip`"
        />
        <slot name="meta" />
      </div>
      <h3
        class="text-text-heading text-sm leading-snug font-semibold text-pretty break-words"
        :data-test="`insight-block-${parts.id}-headline`"
      >
        {{ parts.headline }}
      </h3>
      <p
        v-if="parts.why"
        class="text-text-secondary text-sm leading-relaxed text-pretty"
        :class="{ 'line-clamp-2': !open }"
        :title="parts.why"
        :data-test="`insight-block-${parts.id}-why`"
      >
        {{ parts.why }}
      </p>
      <div class="flex min-h-8 items-center gap-2 pt-1">
        <OButton
          v-if="parts.cta"
          variant="outline"
          size="sm"
          class="min-w-0"
          :loading="pending"
          :title="parts.cta.label"
          :data-test="`insight-block-${parts.id}-cta`"
          @click="emit('cta', parts.cta)"
        >
          {{ parts.cta.label }}
        </OButton>
        <OButton
          v-if="hasDetails"
          variant="ghost-primary"
          size="xs"
          class="ms-auto shrink-0"
          :icon-right="open ? 'expand-less' : 'expand-more'"
          :aria-expanded="open"
          :aria-controls="detailsId"
          :data-test="`insight-block-${parts.id}-details-toggle`"
          @click="open = !open"
        >
          {{ t("insight.labels.details") }}
        </OButton>
      </div>
    </template>
    <div
      v-if="!card || open"
      :id="detailsId"
      class="flex flex-col gap-2.5"
      :class="card ? 'border-border-subtle border-t pt-2.5' : ''"
      :data-test="`insight-block-${parts.id}-details`"
    >
      <dl
        v-if="detailWhy || parts.next || $slots.evidence"
        class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm leading-relaxed"
      >
        <template v-if="detailWhy">
          <dt class="text-text-secondary">{{ t("insight.labels.why") }}</dt>
          <dd
            class="text-text-body text-pretty"
            :data-test="`insight-block-${parts.id}-why-detail`"
          >
            {{ detailWhy }}
          </dd>
        </template>
        <slot name="evidence" />
        <template v-if="parts.next">
          <dt class="text-text-secondary">{{ t("insight.labels.next") }}</dt>
          <dd class="text-text-body text-pretty" :data-test="`insight-block-${parts.id}-next`">
            {{ parts.next }}
          </dd>
        </template>
      </dl>
      <div v-if="parts.facts.length || parts.meta" class="flex flex-wrap items-center gap-1.5">
        <OTag
          v-for="fact in parts.facts"
          :key="fact.label"
          :variant="fact.variant"
          size="xs"
          :label="fact.label"
        />
        <OText v-if="parts.meta" variant="meta" as="span">{{ parts.meta }}</OText>
      </div>
      <div v-if="hasActions" class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <OButton
          v-if="!card && parts.cta"
          variant="primary"
          size="sm"
          :loading="pending"
          :data-test="`insight-block-${parts.id}-cta`"
          @click.stop="emit('cta', parts.cta)"
        >
          {{ parts.cta.label }}
        </OButton>
        <OButton
          v-for="action in parts.secondary"
          :key="action.key"
          variant="outline"
          size="sm"
          :data-test="`insight-block-${parts.id}-secondary-${action.key}`"
          @click.stop="emit('secondary', action)"
        >
          {{ action.label }}
        </OButton>
        <OButton
          v-if="parts.dismissable"
          variant="ghost-muted"
          size="sm"
          :data-test="`insight-block-${parts.id}-dismiss`"
          @click.stop="emit('dismiss')"
        >
          {{ t("insight.actions.dismiss") }}
        </OButton>
        <OText
          v-if="parts.note"
          variant="meta"
          as="span"
          :data-test="`insight-block-${parts.id}-note`"
        >
          {{ parts.note }}
        </OText>
      </div>
    </div>
  </component>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { InsightCta, InsightParts, InsightTone } from "./insightCopy";

const ACCENT: Record<InsightTone, string> = {
  failure: "bg-status-error-text",
  gap: "bg-ingest-accent-amber",
  info: "bg-border-default",
};

const props = withDefaults(
  defineProps<{
    parts: InsightParts;
    variant?: "card" | "details";
    pending?: boolean;
  }>(),
  { variant: "card", pending: false },
);

const emit = defineEmits<{
  cta: [cta: InsightCta];
  secondary: [cta: InsightCta];
  dismiss: [];
}>();

defineSlots<{
  meta?: () => unknown;
  evidence?: () => unknown;
}>();

const { t } = useI18nTyped();

const detailsId = `insight-details-${useId()}`;
const open = ref(false);
const card = computed(() => props.variant === "card");

const detailWhy = computed(() =>
  card.value ? props.parts.whyDetail : (props.parts.whyDetail ?? props.parts.why),
);
const hasActions = computed(
  () =>
    (!card.value && !!props.parts.cta) ||
    props.parts.secondary.length > 0 ||
    !!props.parts.dismissable ||
    !!props.parts.note,
);
const hasDetails = computed(
  () =>
    !!detailWhy.value ||
    !!props.parts.next ||
    props.parts.facts.length > 0 ||
    !!props.parts.meta ||
    hasActions.value,
);
</script>
