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

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

export interface SlackPageSectionLink {
  id: string;
  label: I18nText;
}

const props = defineProps<{ sections: SlackPageSectionLink[] }>();

const { t } = useI18nTyped();
const active = ref(props.sections[0]?.id ?? "");
let observer: IntersectionObserver | null = null;

const elementOf = (id: string) => document.getElementById(`slack-section-${id}`);

const go = (id: string): void => {
  active.value = id;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  elementOf(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
};

onMounted(() => {
  if (typeof IntersectionObserver === "undefined") return;
  // The section whose top crosses the upper third of the view is the one being read.
  observer = new IntersectionObserver(
    (entries) => {
      const hit = entries.find((e) => e.isIntersecting);
      if (hit) active.value = hit.target.id.replace("slack-section-", "");
    },
    // eslint-disable-next-line local/no-hardcoded-px -- IntersectionObserver rootMargin parses px/% only
    { rootMargin: "0px 0px -66% 0px" },
  );
  for (const section of props.sections) {
    const el = elementOf(section.id);
    if (el) observer.observe(el);
  }
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <nav
    class="bg-surface-base border-border-default sticky -top-3 z-10 -mx-4 -mt-3 -mb-1 flex items-center gap-1.5 overflow-x-auto border-b px-4 py-2"
    :aria-label="t('slackApp.sections.onThisPage')"
    data-test="slack-section-bar"
  >
    <span class="text-text-secondary me-1 text-sm whitespace-nowrap">
      {{ t("slackApp.sections.onThisPage") }}
    </span>
    <OButton
      v-for="section in sections"
      :key="section.id"
      variant="section-chip"
      size="sm"
      :aria-current="active === section.id ? 'location' : undefined"
      :data-test="`slack-section-link-${section.id}`"
      @click="go(section.id)"
    >
      {{ section.label }}
    </OButton>
  </nav>
</template>
