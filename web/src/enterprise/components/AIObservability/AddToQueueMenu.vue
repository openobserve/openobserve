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
  "Add To Queue" action: a button that drops the queue list directly, so a single
  row and a bulk selection share one path and neither opens a modal. A queue only
  accepts the scopes in its `allowedRefTypes`, so ineligible queues stay visible
  but disabled — seeing them is how you learn the queue exists.
-->
<template>
  <ODropdown v-model:open="open" side="top" align="end">
    <template #trigger>
      <OButton :variant="variant" size="sm" icon-left="add" :loading="busy" :data-test="dataTest">
        {{ label }}
      </OButton>
    </template>

    <div class="min-w-64 py-1">
      <span
        v-if="loading"
        class="text-text-secondary block px-3 py-2 text-xs"
        data-test="add-to-queue-menu-loading"
      >
        {{ t("aiObservability.discovery.addToQueueMenu.loading") }}
      </span>

      <span
        v-else-if="!queues.length"
        class="text-text-secondary block px-3 py-2 text-xs"
        data-test="add-to-queue-menu-empty"
      >
        {{ t("aiObservability.discovery.addToQueueMenu.noQueues") }}
      </span>

      <template v-else>
        <ODropdownItem
          v-for="queue in queues"
          :key="queue.id"
          :disabled="!accepts(queue)"
          :data-test="`add-to-queue-menu-item-${queue.id}`"
          @select="onSelect(queue)"
        >
          <span class="flex min-w-0 flex-col">
            <span class="truncate font-medium">{{ raw(queue.name) }}</span>
            <span class="text-text-secondary text-2xs">
              {{
                accepts(queue)
                  ? t("aiObservability.discovery.addToQueueMenu.dimensions", {
                      count: queue.scoreConfigs.length,
                    })
                  : t("aiObservability.discovery.addToQueueMenu.accepts", {
                      types: refTypeList(queue),
                    })
              }}
            </span>
          </span>
        </ODropdownItem>
      </template>
    </div>
  </ODropdown>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import type { DiscoveryScope } from "@/services/llm-discovery.service";
import type { LlmQueue } from "@/services/llm-queues.service";

defineOptions({ name: "AddToQueueMenu" });

const props = withDefaults(
  defineProps<{
    /** Scope of the rows being enqueued — decides which queues accept them. */
    scope: DiscoveryScope;
    queues: LlmQueue[];
    label: I18nText;
    loading?: boolean;
    busy?: boolean;
    variant?: ButtonVariant;
    dataTest?: string;
  }>(),
  { loading: false, busy: false, variant: "outline", dataTest: undefined },
);

const emit = defineEmits<{
  (_e: "select", _queue: LlmQueue): void;
  (_e: "open"): void;
}>();

const { t } = useI18nTyped();

const open = ref(false);

// Queues load on first open, never on page load.
watch(open, (isOpen) => {
  if (isOpen) emit("open");
});

// A queue with no declared ref types accepts traces (the backend default).
function refTypes(queue: LlmQueue): string[] {
  return queue.allowedRefTypes.length ? queue.allowedRefTypes : ["trace"];
}

function accepts(queue: LlmQueue): boolean {
  return refTypes(queue).includes(props.scope);
}

function refTypeList(queue: LlmQueue) {
  return raw(refTypes(queue).join(", "));
}

function onSelect(queue: LlmQueue) {
  if (!accepts(queue)) return;
  open.value = false;
  emit("select", queue);
}
</script>
