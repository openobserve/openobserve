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

<!-- The report at reading width, with a sticky index of its sections beside it. -->
<template>
  <div class="flex min-w-0 items-start gap-8">
    <nav
      v-if="sections.length > 1"
      data-test="rca-report-index"
      :aria-label="t('alerts.incidents.rcaLight.reportSections')"
      class="sticky top-0 flex w-52 shrink-0 flex-col gap-1 max-lg:hidden"
    >
      <span class="text-text-secondary px-2.5 pb-1 text-xs font-semibold">
        {{ t("alerts.incidents.rcaLight.onThisReport") }}
      </span>
      <ol class="m-0 flex list-none flex-col gap-0.5 p-0">
        <li v-for="(title, idx) in sections" :key="idx">
          <OButton
            data-test="rca-report-index-item"
            :variant="active === idx ? 'ghost-primary' : 'ghost-neutral'"
            size="sm"
            block
            :active="active === idx"
            class="justify-start text-start whitespace-normal"
            :aria-current="active === idx ? 'true' : undefined"
            @click="go(idx)"
          >
            {{ title }}
          </OButton>
        </li>
      </ol>
    </nav>
    <div ref="contentEl" class="max-w-215 min-w-0 flex-1">
      <RcaReportContent :html="html" :is-dark-mode="isDarkMode" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";
import RcaReportContent from "./RcaReportContent.vue";

const props = defineProps<{
  /** Sanitized report HTML from renderRcaReport. */
  html: string;
  isDarkMode: boolean;
}>();

const { t } = useI18nTyped();

const contentEl = ref<HTMLElement | null>(null);
const sections = ref<string[]>([]);
const active = ref(0);
let headings: HTMLElement[] = [];
let observer: IntersectionObserver | null = null;

const observe = () => {
  observer?.disconnect();
  if (typeof IntersectionObserver === "undefined") return;
  const visible = new Map<Element, boolean>();
  // Each callback carries only the headings that changed; the topmost visible one is current.
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => visible.set(entry.target, entry.isIntersecting));
      const index = headings.findIndex((heading) => visible.get(heading));
      if (index >= 0) active.value = index;
    },
    { rootMargin: "0% 0% -70% 0%" },
  );
  headings.forEach((heading) => observer?.observe(heading));
};

const readSections = async () => {
  await nextTick();
  headings = [...(contentEl.value?.querySelectorAll<HTMLElement>("h2") ?? [])];
  sections.value = headings.map((heading) => heading.textContent?.trim() ?? "");
  active.value = 0;
  observe();
};

const go = (index: number) => {
  active.value = index;
  headings[index]?.scrollIntoView({ block: "start", behavior: "smooth" });
};

onMounted(readSections);
watch(() => props.html, readSections);
onBeforeUnmount(() => observer?.disconnect());
</script>
