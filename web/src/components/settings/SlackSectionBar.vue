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

const elementOf = (id: string) => document.getElementById(`slack-section-${id}`);

const go = (id: string): void => {
  active.value = id;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  elementOf(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
};

/** The last section whose top has reached the upper third; at the end of the page, the last section. */
function pick(scroller: Element | null): void {
  const band = window.innerHeight / 3;
  let current = props.sections[0]?.id ?? "";
  for (const section of props.sections) {
    const top = elementOf(section.id)?.getBoundingClientRect().top;
    if (top !== undefined && top <= band) current = section.id;
  }
  // A short last section never reaches the band, so the end of the scroll stands for it.
  const atEnd =
    !!scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  const last = props.sections.at(-1);
  if (atEnd && last && elementOf(last.id)) current = last.id;
  active.value = current;
}

let frame = 0;
const onScroll = (event: Event): void => {
  const target = event.target instanceof Element ? event.target : document.scrollingElement;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => pick(target));
};

onMounted(() => {
  // The page scrolls inside the settings frame, so the listener captures any scroller.
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  document.removeEventListener("scroll", onScroll, { capture: true });
});
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
