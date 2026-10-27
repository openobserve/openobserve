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
  <span ref="root" class="ms-1 inline-flex items-center align-middle">
    <OTag
      v-if="available"
      type="assistantClaim"
      value="available"
      :label="number"
      clickable
      :aria-label="name"
      :class="HIT_AREA"
      :data-test="`assistant-claim-${n}`"
      :data-call-id="callId"
      @click="open"
    />
    <span
      v-else
      tabindex="0"
      role="note"
      :aria-label="mutedName"
      :class="[
        'rounded-default focus-visible:ring-border-strong inline-flex items-center outline-none focus-visible:ring-2',
        HIT_AREA,
      ]"
      :data-test="`assistant-claim-${n}`"
      data-muted=""
    >
      <OTag type="assistantClaim" value="muted" :label="number" />
      <OTooltip :content="t('assistant.claim.notAvailable')" />
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";

import { assistantEvidenceHostKey, type Sid } from "@/composables/assistant/pure";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import { revealStep } from "./revealStep";

const HIT_AREA =
  "relative max-md:before:absolute max-md:before:top-1/2 max-md:before:left-1/2 max-md:before:size-11 max-md:before:-translate-x-1/2 max-md:before:-translate-y-1/2 max-md:before:content-[''] pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:size-11 pointer-coarse:before:-translate-x-1/2 pointer-coarse:before:-translate-y-1/2 pointer-coarse:before:content-['']";

const props = withDefaults(
  defineProps<{
    n: number;
    callId: string;
    available: boolean;
    /** "Queried default · 13:43–13:58 IST": what the step did. */
    label: I18nText;
    sid?: Sid | null;
    readonly?: boolean;
  }>(),
  { sid: null, readonly: false },
);

const { t } = useI18nTyped();
const host = props.readonly ? null : inject(assistantEvidenceHostKey, null);
const root = ref<HTMLElement | null>(null);

const number = computed(() => raw(String(props.n)));
const name = computed(() => t("assistant.claim.name", { n: props.n, step: props.label }));
const mutedName = computed(() =>
  t("assistant.claim.name", { n: props.n, step: t("assistant.claim.notAvailable") }),
);

async function open(): Promise<void> {
  if (props.sid && host)
    await host.dispatch(props.sid, { kind: "open_step", callId: props.callId });
  await revealStep(root.value, props.callId);
}
</script>
