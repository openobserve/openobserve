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
    class="flex min-h-0 flex-1 flex-col gap-4 p-4 md:flex-row md:gap-6"
    data-test="autoobserve-policy"
  >
    <nav
      class="flex shrink-0 gap-1 overflow-x-auto md:w-56 md:flex-col"
      :aria-label="t('autoobserve.policyLive.nav')"
      data-test="autoobserve-policy-nav"
    >
      <OButton
        v-for="s in SECTIONS"
        :key="s"
        :variant="s === section ? 'secondary' : 'ghost-muted'"
        size="sm"
        class="justify-start"
        :icon-left="SECTION_ICON[s]"
        :aria-current="s === section ? 'page' : undefined"
        :data-test="`autoobserve-policy-nav-${s}`"
        @click="select(s)"
      >
        {{ t(SECTION_TITLE[s]) }}
      </OButton>
    </nav>
    <section
      class="flex max-w-3xl min-w-0 flex-1 flex-col gap-4"
      :data-test="`autoobserve-policy-section-${section}`"
    >
      <header class="flex flex-col gap-1">
        <h2 class="text-text-heading text-base font-semibold">{{ t(SECTION_TITLE[section]) }}</h2>
        <p class="text-text-secondary text-sm leading-relaxed">{{ t(SECTION_LEAD[section]) }}</p>
      </header>
      <PolicyModes v-if="section === 'coverage'" :actions="COVERAGE_ACTIONS" />
      <PolicyModes v-else-if="section === 'alerts'" :actions="ALERT_ACTIONS" />
      <template v-else-if="section === 'investigation'">
        <div class="border-border-subtle rounded-surface bg-surface-base border p-4">
          <AutoObserveSettingsPaging @action="emit('how-it-works')" />
        </div>
        <p
          class="text-text-secondary flex items-start gap-1.5 text-sm"
          :data-on="rcaOn"
          data-test="autoobserve-policy-rca"
        >
          <OIcon name="auto-awesome" size="sm" class="mt-0.5 shrink-0" />
          <span>{{
            rcaOn ? t("autoobserve.policyLive.rcaOn") : t("autoobserve.policyLive.rcaOff")
          }}</span>
        </p>
      </template>
      <template v-else>
        <div class="border-border-subtle rounded-surface bg-surface-base border p-4">
          <AutoObserveSettingsReach />
        </div>
        <OButton
          variant="ghost-primary"
          size="xs"
          icon-right="arrow-forward"
          class="-ms-2 self-start"
          data-test="autoobserve-policy-oncall"
          @click="router.push({ name: 'onCallRouting', query: { org_identifier: org } })"
        >
          {{ t("autoobserveLive.paging.routing") }}
        </OButton>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import AutoObserveSettingsPaging from "../AutoObserveSettingsPaging.vue";
import AutoObserveSettingsReach from "../AutoObserveSettingsReach.vue";
import PolicyModes from "./PolicyModes.vue";
import { ALERT_ACTIONS, COVERAGE_ACTIONS } from "./policyActions";

const SECTIONS = ["coverage", "alerts", "investigation", "channels"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_TITLE: Record<Section, I18nKey> = {
  coverage: "autoobserve.policyLive.sections.coverage",
  alerts: "autoobserve.policyLive.sections.alerts",
  investigation: "autoobserve.policyLive.sections.investigation",
  channels: "autoobserve.policyLive.sections.channels",
};

const SECTION_LEAD: Record<Section, I18nKey> = {
  coverage: "autoobserve.policyLive.leads.coverage",
  alerts: "autoobserve.policyLive.leads.alerts",
  investigation: "autoobserve.policyLive.leads.investigation",
  channels: "autoobserve.policyLive.leads.channels",
};

const SECTION_ICON: Record<Section, IconName> = {
  coverage: "radar",
  alerts: "tune",
  investigation: "notifications-active",
  channels: "forum",
};

const emit = defineEmits<{ "how-it-works": [] }>();

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();
const org = useOrgId();

// The section lives in the URL, so reload and a shared link open the same one.
const section = computed<Section>(
  () => SECTIONS.find((s) => s === route.query.section) ?? "coverage",
);
const rcaOn = computed(() => store.state.zoConfig?.incidents_rca_enabled === true);

const select = (s: Section) =>
  void router.replace({ query: { ...route.query, section: s === "coverage" ? undefined : s } });
</script>
