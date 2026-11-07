<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

const { t } = useI18nTyped();

const store = useStore();
const router = useRouter();

const mode = computed(() => store.state.solutionMode as "observability" | "security");

const SOLUTIONS: {
  key: "observability" | "security";
  labelKey: I18nKey;
  icon: IconName;
  descriptionKey: I18nKey;
  route: string;
}[] = [
  {
    key: "observability",
    labelKey: "solutionSwitcher.observability.label",
    icon: "monitor-heart",
    descriptionKey: "solutionSwitcher.observability.description",
    route: "/",
  },
  {
    key: "security",
    labelKey: "solutionSwitcher.security.label",
    icon: "verified-user",
    descriptionKey: "solutionSwitcher.security.description",
    route: "/security/overview",
  },
];

const current = computed(() => SOLUTIONS.find((s) => s.key === mode.value) ?? SOLUTIONS[0]);

function switchTo(solution: (typeof SOLUTIONS)[0]) {
  if (solution.key === mode.value) return;
  store.commit("setSolutionMode", solution.key);
  router.push({
    path: solution.route,
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
}
</script>

<template>
  <ODropdown side="bottom" align="start">
    <template #trigger>
      <OButton
        variant="ghost"
        size="sm"
        :icon-left="current.icon"
        icon-right="expand-more"
        class="font-[650] tracking-[-0.00625rem]"
        data-test="solution-switcher"
      >
        {{ t(current.labelKey) }}
      </OButton>
    </template>

    <div class="text-3xs px-3.5 pt-1.5 pb-1 font-bold tracking-[0.03125rem] uppercase opacity-50">
      {{ t("solutionSwitcher.title") }}
    </div>

    <ODropdownItem
      v-for="solution in SOLUTIONS"
      :key="solution.key"
      :data-test="`solution-${solution.key}`"
      @select="switchTo(solution)"
    >
      <div class="flex min-w-[13.75rem] items-center gap-2.5">
        <div
          class="rounded-default flex size-8 shrink-0 items-center justify-center"
          :class="
            solution.key === 'security'
              ? 'bg-status-success-bg text-status-success-text'
              : 'bg-accent/12 text-accent'
          "
        >
          <OIcon :name="solution.icon" size="sm" />
        </div>
        <div class="flex flex-1 flex-col gap-px">
          <span class="text-compact font-[650]">{{ t(solution.labelKey) }}</span>
          <span class="text-2xs opacity-55">{{ t(solution.descriptionKey) }}</span>
        </div>
        <OIcon v-if="solution.key === mode" name="task-alt" class="text-accent size-3.5 shrink-0" />
      </div>
    </ODropdownItem>

    <ODropdownSeparator />
    <div class="text-2xs flex items-center gap-1.5 px-3.5 pt-1.5 pb-2 opacity-45">
      <OIcon name="info-outline" size="xs" class="opacity-50" />
      <span>{{ t("solutionSwitcher.hint") }}</span>
    </div>
  </ODropdown>
</template>
