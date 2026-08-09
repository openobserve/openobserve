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
  DbmSuggestFixButton — the "ask the assistant about THIS" affordance, in one
  place so the four DBM surfaces that carry it cannot drift apart.

  It owns the enterprise + `ai_enabled` gate itself rather than making each
  caller repeat it. That is the point: a gate written four times is a gate that
  is eventually written three times, and the fourth renders a button that opens
  a panel the deployment does not have. When AI is off this renders nothing at
  all — no wrapper, no gap — so no layout space is reserved for it.

  The gradient/hover treatment is copied verbatim from the header AI button and
  QueryErrorState, so every AI entry point in the app reads as the same control.
-->
<template>
  <OButton
    v-if="aiEnabled"
    variant="ghost"
    :size="size"
    class="group text-ai-accent! shrink-0 [background:var(--color-gradient-ai-subtle)]! [transition:background_0.3s_ease,box-shadow_0.3s_ease,color_0.3s_ease] hover:text-white! hover:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_35%,transparent)] hover:[background:var(--color-gradient-ai)]! dark:text-white! dark:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)] dark:hover:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_35%,transparent)]"
    :data-test="dataTest"
    @click.stop="emit('click')"
  >
    <template #icon-left>
      <img
        :src="aiIconSrc"
        class="h-4 w-4 shrink-0 group-hover:brightness-0 group-hover:invert group-hover:[transition:filter_0.3s_ease]"
        alt=""
      />
    </template>
    {{ label }}
    <OTooltip v-if="tooltip" side="top" :content="tooltip" />
  </OButton>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";

import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import type { ButtonSize } from "@/lib/core/Button/OButton.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useAiIcon } from "@/composables/useAiIcon";
import type { I18nText } from "@/types/i18n";

withDefaults(
  defineProps<{
    label: I18nText;
    /** Says what the assistant will be told, so the click is not a leap of faith. */
    tooltip?: I18nText | null;
    size?: ButtonSize;
    dataTest?: string;
  }>(),
  { tooltip: null, size: "sm", dataTest: "dbm-suggest-fix" },
);

const emit = defineEmits<{ (e: "click"): void }>();

const store = useStore();
const { aiIconSrc } = useAiIcon();

const aiEnabled = computed(
  () => config.isEnterprise == "true" && Boolean(store.state.zoConfig?.ai_enabled),
);
</script>
