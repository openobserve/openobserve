<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Header toggle: Observability ↔ Security (SIEM).
     Sets store.state.solutionMode and routes to the correct entry point. -->
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const store = useStore();
const router = useRouter();

const mode = computed(() => store.state.solutionMode as "observability" | "security");

const SOLUTIONS = [
  {
    key: "observability" as const,
    label: "Observability",
    icon: "monitor-heart",
    description: "Logs, metrics, traces, dashboards",
    route: "/",
  },
  {
    key: "security" as const,
    label: "Security",
    icon: "verified-user",
    description: "SIEM · OCSF · Sigma rules",
    route: "/security/overview",
  },
];

const current = computed(() => SOLUTIONS.find(s => s.key === mode.value) ?? SOLUTIONS[0]);

function switchTo(solution: typeof SOLUTIONS[0]) {
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

    <div class="solution-switcher-header">Solution</div>

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
          <OIcon :name="solution.icon" style="width:16px;height:16px" />
        </div>
        <div class="solution-text">
          <span class="solution-label">{{ solution.label }}</span>
          <span class="solution-desc">{{ solution.description }}</span>
        </div>
        <OIcon
          v-if="solution.key === mode"
          name="task-alt"
          style="width:14px;height:14px;color:var(--o2-accent,#6d5ce0);flex-shrink:0"
        />
      </div>
    </ODropdownItem>

    <ODropdownSeparator />
    <div class="solution-switcher-footer">
      <OIcon name="info-outline" style="width:12px;height:12px;opacity:0.5" />
      <span>Switch products without losing your place</span>
    </div>
  </ODropdown>
</template>

<style scoped>
.solution-switcher-btn {
  font-weight: 650;
  letter-spacing: -0.1px;
}

.solution-switcher-header {
  padding: 6px 14px 4px;
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.5;
}

.solution-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
}

.solution-ico {
  width: 32px;
  height: 32px;
  border-radius: 8px;
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
  gap: 1px;
}

.solution-label {
  font-size: 13px;
  font-weight: 650;
}

.solution-desc {
  font-size: 11px;
  opacity: 0.55;
}

.solution-switcher-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px 8px;
  font-size: 11px;
  opacity: 0.45;
}
</style>
