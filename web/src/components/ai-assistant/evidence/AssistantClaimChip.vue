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
  <OTag
    v-if="available"
    type="assistantClaim"
    value="available"
    :label="number"
    clickable
    :aria-label="label"
    :class="['ms-1 align-middle', HIT_AREA, PILL]"
    :data-test="`assistant-claim-${n}`"
    :data-call-id="callId"
    @click="open"
  />
  <OTag
    v-else
    type="assistantClaim"
    value="muted"
    :label="number"
    aria-hidden="true"
    class="ms-1 align-middle"
    :data-test="`assistant-claim-${n}`"
    data-muted=""
  />
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import { raw, type I18nText } from "@/types/i18n";

import { revealStep } from "./revealStep";

const HIT_AREA =
  "relative max-md:before:absolute max-md:before:top-1/2 max-md:before:left-1/2 max-md:before:size-11 max-md:before:-translate-x-1/2 max-md:before:-translate-y-1/2 max-md:before:content-[''] pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:size-11 pointer-coarse:before:-translate-x-1/2 pointer-coarse:before:-translate-y-1/2 pointer-coarse:before:content-['']";

const PILL = "bg-text-link/12 text-assistant-link border-transparent font-medium";

const props = defineProps<{
  n: number;
  callId: string;
  available: boolean;
  /** "Citation 1, query 1, 3 rows". */
  label: I18nText;
}>();

const number = computed(() => raw(String(props.n)));

function open(event: MouseEvent | KeyboardEvent): void {
  const from = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  void revealStep(from, props.callId);
}
</script>
