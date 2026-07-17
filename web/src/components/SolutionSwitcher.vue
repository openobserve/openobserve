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
  SolutionSwitcher
  ────────────────
  Flips the whole app shell between product "solution modes" within the current
  org: Observability (default) and Security (SIEM). Reads/writes
  store.state.solutionMode. Uses the app's ODropdown/OButton so it matches the
  OrganizationSelector next to it.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import config from "@/aws-exports";

const store = useStore();
const router = useRouter();

const open = ref(false);

const isEnterprise = config.isEnterprise === "true" || config.isCloud === "true";

const allSolutions = [
  {
    value: "observability",
    label: "Observability",
    icon: "dashboard",
    color: "linear-gradient(135deg,#5960b2,#7d84d8)",
    desc: "Logs, metrics, traces, RUM and dashboards for your services.",
    route: "/",
    enterprise: false,
  },
  {
    value: "security",
    label: "Security",
    tag: "SIEM",
    icon: "shield-alert-outline",
    color: "linear-gradient(135deg,#6d5ce0,#b14bd8)",
    desc: "Events, detections, alerts, cases, threat intel and MITRE ATT&CK.",
    route: "/security",
    enterprise: false,
  },
  {
    value: "fleet",
    label: "Fleet Management",
    tag: "Enterprise",
    icon: "router",
    color: "linear-gradient(135deg,#0d7a5f,#1aaf88)",
    desc: "Manage agents, collectors and data sources across your entire infrastructure.",
    route: "/fleet",
    enterprise: true,
  },
];

const solutions = computed(() =>
  allSolutions.filter((s) => !s.enterprise || isEnterprise),
);

const modelValue = computed(
  () => store.state.solutionMode || "observability",
);
const currentSolution = computed(
  () => solutions.value.find((s) => s.value === modelValue.value) || allSolutions[0],
);

const select = (sol: typeof allSolutions[0]) => {
  if (sol.enterprise && !isEnterprise) return;
  open.value = false;
  if (sol.value === modelValue.value) return;
  store.dispatch("setSolutionMode", sol.value);
  const orgId = store.state.selectedOrganization?.identifier;
  router.push({
    path: sol.route,
    query: orgId ? { org_identifier: orgId } : {},
  });
};
</script>

<template>
  <div data-test="solution-switcher">
    <ODropdown v-model:open="open" side="bottom" align="start">
      <template #trigger>
        <OButton
          variant="outline-primary"
          size="xs"
          data-test="solution-switcher-trigger"
          class="w-44 text-text-primary!"
          :class="open ? 'ring-1 ring-inset ring-primary-300' : ''"
        >
          <template #icon-left>
            <OIcon
              :name="currentSolution.icon"
              size="sm"
              class="opacity-70 shrink-0"
            />
          </template>
          <span class="truncate flex-1 min-w-0 text-left">{{
            currentSolution.label
          }}</span>
          <template #icon-right>
            <OIcon
              name="arrow-drop-down"
              size="sm"
              class="opacity-70 shrink-0 transition-transform"
              :class="open ? 'rotate-180' : ''"
            />
          </template>
        </OButton>
      </template>

      <div
        data-test="solution-switcher-list"
        class="flex flex-col w-80 max-w-[98vw] py-1"
      >
        <button
          v-for="sol in solutions"
          :key="sol.value"
          type="button"
          :data-test="`solution-switcher-option-${sol.value}`"
          class="flex items-start gap-3 px-3 py-2.5 mx-1 rounded-md text-left transition-colors"
          :class="[
            sol.value === modelValue ? 'bg-select-item-hover-bg' : 'hover:bg-select-item-hover-bg',
          ]"
          @click="select(sol)"
        >
          <span
            class="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
            :style="{ background: sol.color }"
          >
            <OIcon :name="sol.icon" size="sm" class="text-white!" />
          </span>
          <span class="flex-1 min-w-0">
            <span
              class="flex items-center gap-2 text-[13px] font-semibold text-text-primary"
            >
              {{ sol.label }}
              <span
                v-if="sol.tag"
                class="text-[10px] font-semibold leading-none px-1.5 py-0.5 rounded"
                :class="sol.tag === 'Enterprise'
                  ? 'border border-emerald-500 text-emerald-600'
                  : 'border border-primary-400 text-primary-500'"
                >{{ sol.tag }}</span
              >
            </span>
            <span
              class="block text-[11.5px] leading-snug text-text-secondary mt-0.5"
              >{{ sol.desc }}</span
            >
          </span>
          <OIcon
            v-if="sol.value === modelValue"
            name="check"
            size="sm"
            class="text-primary-500 shrink-0 mt-0.5"
          />
        </button>
      </div>
    </ODropdown>
  </div>
</template>
