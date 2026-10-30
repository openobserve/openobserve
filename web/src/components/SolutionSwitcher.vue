<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Header toggle: Observability ↔ Security (SIEM).
     Sets store.state.solutionMode and routes to the correct entry point. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
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
  label: string;
  icon: IconName;
  description: string;
  route: string;
}[] = [
  {
    key: "observability",
    label: "Observability",
    icon: "monitor-heart",
    description: "Logs, metrics, traces, dashboards",
    route: "/",
  },
  {
    key: "security",
    label: "Security",
    icon: "verified-user",
    description: "SIEM · OCSF · Sigma rules",
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
        class="solution-switcher-btn"
        data-test="solution-switcher"
      >
        {{ current.label }}
      </OButton>
    </template>

    <div class="solution-switcher-header">{{ t("solutionSwitcher.title") }}</div>

    <ODropdownItem
      v-for="solution in SOLUTIONS"
      :key="solution.key"
      :data-test="`solution-${solution.key}`"
      @select="switchTo(solution)"
    >
      <div class="solution-item">
        <div
          class="solution-ico"
          :class="solution.key === 'security' ? 'solution-ico--sec' : 'solution-ico--obs'"
        >
          <OIcon :name="solution.icon" size="sm" />
        </div>
        <div class="solution-text">
          <span class="solution-label">{{ solution.label }}</span>
          <span class="solution-desc">{{ solution.description }}</span>
        </div>
        <OIcon v-if="solution.key === mode" name="task-alt" class="text-accent size-3.5 shrink-0" />
      </div>
    </ODropdownItem>

    <ODropdownSeparator />
    <div class="solution-switcher-footer">
      <OIcon name="info-outline" size="xs" class="opacity-50" />
      <span>{{ t("solutionSwitcher.hint") }}</span>
    </div>
  </ODropdown>
</template>

<style scoped>
.solution-switcher-btn {
  font-weight: 650;
  letter-spacing: -0.00625rem;
}

.solution-switcher-header {
  padding: 0.375rem 0.875rem 0.25rem;
  font-size: 0.65625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03125rem;
  opacity: 0.5;
}

.solution-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-width: 13.75rem;
}

.solution-ico {
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.solution-ico--obs {
  background: rgba(109, 92, 224, 0.12);
  color: #6d5ce0;
}

.solution-ico--sec {
  background: rgba(48, 164, 108, 0.12);
  color: #30a46c;
}

body.body--dark .solution-ico--obs {
  background: rgba(139, 144, 230, 0.16);
  color: #8b90e6;
}

body.body--dark .solution-ico--sec {
  background: rgba(48, 164, 108, 0.18);
  color: #4cc38a;
}

.solution-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
}

.solution-label {
  font-size: 0.8125rem;
  font-weight: 650;
}

.solution-desc {
  font-size: 0.6875rem;
  opacity: 0.55;
}

.solution-switcher-footer {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.875rem 0.5rem;
  font-size: 0.6875rem;
  opacity: 0.45;
}
</style>
