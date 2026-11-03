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
    v-if="message.count"
    ref="root"
    tabindex="-1"
    :role="role"
    class="rounded-default border-banner-error-soft-border bg-banner-error-soft-bg text-banner-error-soft-text focus-visible:ring-focus-ring flex max-h-[60vh] w-[min(22.5rem,calc(100vw-1.5rem))] gap-2 overflow-y-auto border p-3 text-sm outline-none focus-visible:ring-2"
  >
    <OIcon name="error" size="sm" class="mt-0.5 shrink-0" />
    <div class="flex min-w-0 flex-1 flex-col items-start gap-1.5">
      <div class="font-medium" data-test="access-denied-title">{{ message.title }}</div>
      <i18n-t
        v-if="message.groups.length === 1"
        keypath="accessBoundary.denied.missing"
        tag="p"
        class="text-text-body break-words"
        data-test="access-denied-reason"
      >
        <template #permission>{{ message.groups[0].label }}</template>
        <template #resource>
          <ResourceList :resources="message.groups[0].resources" />
        </template>
      </i18n-t>
      <template v-else-if="message.groups.length > 1">
        <p class="text-text-body">{{ t("accessBoundary.denied.missingIntro") }}</p>
        <dl
          class="text-text-body grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1"
          data-test="access-denied-groups"
        >
          <template v-for="group in message.groups" :key="group.permission">
            <dt class="font-semibold">{{ group.label }}</dt>
            <dd class="break-words" data-test="access-denied-row">
              <ResourceList :resources="group.resources" />
            </dd>
          </template>
        </dl>
      </template>
      <p v-if="message.askAdmin" class="text-text-body" data-test="access-denied-ask-admin">
        {{ t("accessBoundary.denied.askAdmin") }}
      </p>
      <div class="flex flex-wrap items-center gap-1">
        <OButton
          variant="ghost-primary"
          size="xs"
          icon-left="content-copy"
          data-test="access-denied-copy"
          @click="copyDetails"
        >
          {{ copied ? t("accessBoundary.copied") : t("accessBoundary.copyDetails") }}
        </OButton>
        <OButton
          v-if="expanded && folds"
          variant="ghost-primary"
          size="xs"
          data-test="access-denied-show-less"
          @click="expanded = false"
        >
          {{ t("accessBoundary.denied.showLess") }}
        </OButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref, watch, type FunctionalComponent } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useAccessCopy } from "@/components/access/useAccessCopy";
import {
  ACCESS_LIST_LIMIT,
  accessDeniedMessage,
  accessDetails,
  accessListParts,
  type AccessDenial,
} from "@/composables/useAccessStore";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = defineProps<{
  denials: AccessDenial[];
  /** "alert" only where the user just acted; a card opened on request is a status. */
  role: "alert" | "status";
}>();

const { t } = useI18nTyped();
const root = ref<HTMLElement | null>(null);
const expanded = ref(false);
const message = computed(() => accessDeniedMessage(props.denials, t));
const folds = computed(() =>
  message.value.groups.some((g) => g.resources.length > ACCESS_LIST_LIMIT),
);
const { copied, copyDetails } = useAccessCopy(() => accessDetails(props.denials));

// One toggle for the whole card: any row's "N more" expands every row.
const ResourceList: FunctionalComponent<{ resources: I18nText[] }> = ({ resources }) =>
  accessListParts(resources, expanded.value, t).map((part) =>
    part.more
      ? h(
          "button",
          {
            type: "button",
            class:
              "text-text-link hover:text-text-link-hover focus-visible:ring-focus-ring rounded-default font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2",
            "data-test": "access-denied-more",
            onClick: () => (expanded.value = true),
          },
          part.text,
        )
      : part.text,
  );

watch(
  () => props.denials,
  () => {
    copied.value = false;
    expanded.value = false;
  },
);

defineExpose({ focus: () => root.value?.focus() });
</script>
