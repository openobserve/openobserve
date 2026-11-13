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
    class="mx-auto flex h-full min-h-0 w-full max-w-6xl min-w-0 flex-col gap-3 px-4 py-4"
    data-test="assistant-capabilities"
  >
    <div class="flex min-w-0 items-center gap-3 max-md:flex-wrap">
      <OButton
        variant="outline"
        size="icon"
        class="shrink-0 max-md:min-h-11"
        :aria-label="t('home.agent.capabilities.back')"
        data-test="assistant-capabilities-back"
        @click="emit('back')"
      >
        <OIcon name="arrow-back" size="sm" />
        <OTooltip :content="t('home.agent.capabilities.back')" />
      </OButton>
      <OProgressBar
        :value="Math.max(percent, 2) / 100"
        size="xs"
        class="min-w-0 flex-1"
        :aria-label="t('home.agent.capabilities.progressLabel')"
        data-test="assistant-capabilities-progress"
      />
    </div>
    <div class="relative min-h-0 flex-1">
      <div
        ref="scroller"
        class="h-full snap-y snap-mandatory overflow-y-auto scroll-smooth motion-reduce:scroll-auto"
        tabindex="0"
        data-test="assistant-capabilities-scroller"
        @scroll.passive="onScroll"
      >
        <section
          v-for="(slide, i) in SLIDES"
          :key="slide.id"
          class="grid h-full min-h-0 snap-start grid-cols-2 items-center gap-8 pe-10 max-md:grid-cols-1 max-md:gap-4 max-md:pe-8"
          data-test="assistant-capabilities-slide"
        >
          <div class="flex min-w-0 flex-col gap-3">
            <p class="text-text-secondary text-sm">{{ t("home.agent.capabilities.problem") }}</p>
            <h3 class="text-text-heading text-2xl font-semibold">{{ t(slide.title) }}</h3>
            <p class="text-text-body text-base">{{ t(slide.text) }}</p>
            <div v-if="i === SLIDES.length - 1" class="mt-2">
              <OButton
                variant="primary"
                data-test="assistant-capabilities-try"
                @click="emit('try', t('home.agent.capabilities.tryPrompt'))"
              >
                {{ t("home.agent.capabilities.try") }}
              </OButton>
            </div>
          </div>
          <div
            class="border-border-default rounded-surface bg-surface-panel min-w-0 overflow-hidden border border-[0.0625em] p-2"
          >
            <img
              :src="slide.img"
              :alt="t(slide.alt)"
              loading="lazy"
              class="rounded-default block aspect-[4/3] w-full object-contain"
            />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

import investigate from "@/assets/assistant-capabilities/slide-1-investigate.gif";
import chart from "@/assets/assistant-capabilities/slide-2-chart.gif";
import query from "@/assets/assistant-capabilities/slide-3-query.gif";
import dashboard from "@/assets/assistant-capabilities/slide-4-dashboard.gif";
import alert from "@/assets/assistant-capabilities/slide-5-alert.gif";
import share from "@/assets/assistant-capabilities/slide-6-share.gif";

interface Slide {
  id: string;
  title: I18nKey;
  text: I18nKey;
  alt: I18nKey;
  img: string;
}

const P = "home.agent.capabilities.slides";
const SLIDES: Slide[] = [
  { id: "investigate", img: investigate },
  { id: "chart", img: chart },
  { id: "query", img: query },
  { id: "dashboard", img: dashboard },
  { id: "alert", img: alert },
  { id: "share", img: share },
].map((s) => ({
  ...s,
  title: `${P}.${s.id}.title` as I18nKey,
  text: `${P}.${s.id}.text` as I18nKey,
  alt: `${P}.${s.id}.alt` as I18nKey,
}));

const emit = defineEmits<{ back: []; try: [prompt: string] }>();

const { t } = useI18nTyped();
const scroller = ref<HTMLElement | null>(null);
const percent = ref(0);

function onScroll(): void {
  const el = scroller.value;
  if (!el) return;
  const max = el.scrollHeight - el.clientHeight || 1;
  percent.value = Math.round(Math.min(1, el.scrollTop / max) * 100);
}
</script>
