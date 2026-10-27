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
  <template v-if="href">
    <span class="hidden @md:inline-flex">
      <OButton
        :variant="variant"
        size="sm"
        as="a"
        :href="href"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="t('assistant.credits.manageName')"
        :class="TOUCH_TARGET_CLASS"
        :data-test="`${idPrefix}-manage`"
        @click="emit('manage')"
      >
        {{ t("assistant.credits.manage") }}
      </OButton>
    </span>
    <span class="inline-flex @md:hidden">
      <ODropdown align="end">
        <template #trigger>
          <OButton
            variant="ghost"
            size="icon-sm"
            :icon-left="assistantGlyph.more"
            :aria-label="t('assistant.credits.more')"
            :class="TOUCH_TARGET_CLASS"
            :data-test="`${idPrefix}-more`"
          />
        </template>
        <ODropdownItem
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          :data-test="`${idPrefix}-more-manage`"
          @select="open"
        >
          {{ t("assistant.credits.manageName") }}
        </ODropdownItem>
      </ODropdown>
    </span>
  </template>
</template>

<script lang="ts">
import type { Router } from "vue-router";

export interface AssistantCreditManageProps {
  org: string;
  variant: "ghost" | "outline";
  /** The `data-test` stem of the host: `{idPrefix}-manage`, `-more`, `-more-manage`. */
  idPrefix: string;
}

export interface AssistantCreditManageEmits {
  (e: "manage"): void;
}

/** Billing › Plans for `org`, or `null` where the route does not exist (specs, non-Cloud builds). */
export function billingHrefOf(router: Router | undefined, org: string): string | null {
  try {
    return router?.resolve({ name: "plans", query: { org_identifier: org } }).href ?? null;
  } catch {
    return null;
  }
}
</script>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { openTabWithoutOpener } from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useI18nTyped } from "@/types/i18n";

const props = defineProps<AssistantCreditManageProps>();
const emit = defineEmits<AssistantCreditManageEmits>();

const { t } = useI18nTyped();
const router = useRouter();
const href = computed(() => billingHrefOf(router, props.org));

// A blocked new tab still reaches billing here.
function open(): void {
  const value = href.value;
  if (!value) return;
  if (!openTabWithoutOpener(value))
    void router
      .push({ name: "plans", query: { org_identifier: props.org } })
      .catch(() => undefined);
  emit("manage");
}
</script>
