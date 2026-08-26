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
  A faithful, static mirror of the public status page (status_page.html),
  driven entirely by the editor's live form state so a configurer sees their
  choices — brand name, accent color, banner, component cards, timeline bars —
  as they type. The uptime/timeline data is representative SAMPLE data, not real
  check results: this pane answers "how will my page look", not "is it up".
-->
<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 items-center justify-between gap-2 pb-3">
      <div class="min-w-0">
        <h3 class="text-sm font-semibold">{{ t("statusPages.preview.title") }}</h3>
        <p class="text-text-secondary text-xs">{{ t("statusPages.preview.subtitle") }}</p>
      </div>
      <OBadge variant="default-soft" size="sm">{{ t("statusPages.preview.sampleBadge") }}</OBadge>
    </div>

    <!-- The "browser" frame around the rendered page -->
    <div
      class="rounded-surface border-border-default bg-surface-base flex min-h-0 flex-1 flex-col overflow-hidden border"
    >
      <!-- Faux browser chrome with the public URL -->
      <div
        class="border-border-default bg-surface-subtle flex shrink-0 items-center gap-2 border-b px-3 py-2"
      >
        <span class="bg-error-500/60 h-2.5 w-2.5 rounded-full" aria-hidden="true" />
        <span class="bg-warning-500/60 h-2.5 w-2.5 rounded-full" aria-hidden="true" />
        <span class="bg-success-500/60 h-2.5 w-2.5 rounded-full" aria-hidden="true" />
        <span class="text-text-secondary ml-2 min-w-0 flex-1 truncate font-mono text-xs">{{
          displayUrl
        }}</span>
      </div>

      <!-- Rendered page body -->
      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5" :style="accentStyle">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p
              class="text-2xs font-bold tracking-widest uppercase"
              :style="{ color: 'var(--sp-accent, var(--color-primary-600))' }"
            >
              {{ t("statusPages.preview.eyebrow") }}
            </p>
            <img
              v-if="logoImg"
              :src="`data:image;base64,${logoImg}`"
              :alt="headingName"
              data-test="status-page-preview-logo"
              class="my-1 max-h-9 max-w-37.5 object-contain"
            />
            <h1 class="text-text-heading mt-1 text-xl font-semibold">{{ headingName }}</h1>
            <p class="text-text-secondary mt-1 text-xs">{{ visibilityNote }}</p>
          </div>
          <div class="text-text-secondary text-2xs flex shrink-0 items-center gap-1.5">
            <span>{{ t("statusPages.preview.poweredBy") }}</span>
            <!-- The mark's central glyph inherits currentColor (heading ink) so it
                 reads in both themes; the four petals keep their brand colors. -->
            <svg
              class="text-text-heading h-3.5 w-3.5 shrink-0"
              viewBox="0 0 60 84"
              role="img"
              aria-label="OpenObserve"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M47.3676 25.2808C45.6634 27.959 42.0935 28.799 39.3381 27.1963C39.3237 27.1893 39.3094 27.1787 39.295 27.1717C39.2484 27.1436 39.2017 27.1155 39.1551 27.0873C30.8386 22.1036 19.9604 24.5955 14.7653 32.6897C16.3905 29.9939 15.533 26.5039 12.8027 24.838C10.0437 23.1509 6.41643 23.9663 4.67993 26.655C4.68711 26.641 4.69787 26.6304 4.70505 26.6164C13.3552 13.0358 31.5812 8.87796 45.4624 17.299C45.4696 17.299 45.4732 17.3061 45.4804 17.3096C45.4804 17.3096 45.484 17.3096 45.4876 17.3131C48.2502 19.0072 49.0933 22.5745 47.3676 25.2843V25.2808Z"
                fill="#6B76E3"
              />
              <path
                d="M12.3502 58.6929C10.6281 61.3957 11.4604 64.949 14.2051 66.6501C14.1907 66.6431 14.18 66.6325 14.1656 66.6255C0.359754 58.1868 -3.90974 40.4344 4.5539 26.8608C4.58978 26.8011 4.62565 26.7413 4.66512 26.6816C4.67229 26.671 4.67588 26.6605 4.68306 26.6499C6.41956 23.9612 10.0468 23.1458 12.8059 24.8329C15.5326 26.4988 16.3937 29.9888 14.7684 32.6846C14.7684 32.6881 14.7684 32.6916 14.7612 32.6951C14.754 32.7092 14.7433 32.7232 14.7361 32.7373C14.7074 32.783 14.6787 32.8287 14.65 32.8744C14.65 32.8814 14.6428 32.8849 14.6392 32.8919C9.56965 41.0424 12.117 51.6883 20.3833 56.7704C17.6314 55.1678 14.0616 56.0113 12.3574 58.6859L12.3502 58.6929Z"
                fill="#F45B49"
              />
              <path
                d="M55.0521 57.2985C55.0377 57.3196 55.027 57.3407 55.0126 57.3618C46.3983 70.8861 28.2763 75.0686 14.4203 66.7775C14.3594 66.7424 14.2984 66.7072 14.2374 66.6686C14.2266 66.6615 14.2158 66.658 14.2051 66.651C11.4604 64.9499 10.628 61.3966 12.3502 58.6938C14.0544 56.0192 17.6243 55.1757 20.3761 56.7783C20.3905 56.7854 20.4048 56.7959 20.4192 56.8029C20.4658 56.8311 20.5124 56.8592 20.5591 56.8873C20.5591 56.8873 20.5663 56.8873 20.5663 56.8943C28.8862 61.8711 39.7645 59.3757 44.956 51.2744C43.32 53.9701 44.1775 57.4707 46.9078 59.1402C49.674 60.8307 53.3192 60.0083 55.0485 57.2985H55.0521Z"
                fill="#5ACA7A"
              />
              <path
                d="M55.0632 57.2746C55.0632 57.2746 55.056 57.2851 55.0524 57.2922C55.0524 57.2922 55.0524 57.2957 55.0488 57.2992C53.3195 60.0055 49.6779 60.8314 46.9081 59.1409C44.1778 57.4714 43.3203 53.9743 44.9563 51.2751C44.9635 51.261 44.9743 51.247 44.9814 51.2329C45.0101 51.1872 45.0388 51.1415 45.0675 51.0959C50.155 42.9419 47.6113 32.282 39.3342 27.1963C42.0861 28.7989 45.6595 27.9589 47.3637 25.2808C49.0895 22.571 48.2499 19.0036 45.4837 17.3096C45.5053 17.3236 45.5268 17.3342 45.5483 17.3482C59.4116 25.822 63.656 43.6764 55.0596 57.2746H55.0632Z"
                fill="#45A4F3"
              />
              <path
                d="M32.1478 54.937L26.9204 38.5587L23.7452 50.2133L20.4767 43.5917C20.4229 43.4792 20.3045 43.4089 20.179 43.4089H13.8572C13.215 43.4089 12.6804 42.9134 12.6661 42.2842C12.6661 42.2702 12.6661 42.2526 12.6661 42.2385C12.6589 41.5989 13.2043 41.0857 13.8572 41.0857H20.179C21.2158 41.0857 22.1594 41.6657 22.6115 42.5795L23.103 43.5741L26.741 30.2148L32.1442 47.1415L36.1948 34.3938L38.8821 40.5621C38.9503 40.7202 39.1117 40.8257 39.2875 40.8257H46.0398C46.682 40.8257 47.2202 41.3283 47.2166 41.9574C47.2166 41.9785 47.2166 41.9995 47.2166 42.0206C47.2094 42.6462 46.6784 43.1488 46.0362 43.1488H38.8319C37.978 43.1488 37.2102 42.6498 36.8729 41.8836L36.5357 41.1139L32.1406 54.937H32.1478Z"
                fill="currentColor"
              />
            </svg>
            <strong class="text-text-heading font-semibold">OpenObserve</strong>
          </div>
        </div>

        <!-- Overall banner -->
        <div
          class="bg-status-success-bg text-status-success-text rounded-default mt-4 flex items-center gap-2.5 px-4 py-3"
        >
          <span class="h-3 w-3 rounded-full bg-current" aria-hidden="true" />
          <span class="text-sm font-medium">{{ t("statusPages.preview.allOperational") }}</span>
        </div>

        <!-- Components -->
        <div class="mt-5 flex flex-col gap-3">
          <p v-if="visibleComponents.length === 0" class="text-text-secondary text-xs italic">
            {{ t("statusPages.preview.empty") }}
          </p>

          <div
            v-for="(comp, idx) in visibleComponents"
            :key="idx"
            class="rounded-surface border-border-default bg-surface-base border p-3.5"
          >
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-text-heading text-sm font-semibold">{{ comp.name }}</h3>
              <span
                class="bg-status-success-bg text-status-success-text rounded-full inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                {{ t("statusPages.preview.operational") }}
              </span>
            </div>

            <!-- Timeline bars — 90 sample day cells -->
            <div v-if="showTimelineBars" class="mt-3 flex items-end gap-px" aria-hidden="true">
              <span
                v-for="(cell, i) in sampleTimeline(idx)"
                :key="i"
                class="rounded-default h-8 min-w-0.5 flex-1"
                :class="cell"
              />
            </div>

            <div class="text-text-secondary text-2xs mt-2 flex items-center justify-between">
              <span>{{ t("statusPages.preview.legendUptime") }}</span>
              <span
                v-if="showUptimePercent"
                class="text-text-heading font-mono font-semibold tabular-nums"
                >{{ sampleUptime(idx) }}%</span
              >
            </div>
          </div>
        </div>

        <div
          class="text-text-secondary border-border-default text-2xs mt-6 flex items-center gap-1.5 border-t pt-3"
        >
          <span>{{ t("statusPages.preview.poweredBy") }}</span>
          <!-- The mark's central glyph inherits currentColor (heading ink) so it
               reads in both themes; the four petals keep their brand colors. -->
          <svg
            class="text-text-heading h-3.5 w-3.5 shrink-0"
            viewBox="0 0 60 84"
            role="img"
            aria-label="OpenObserve"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M47.3676 25.2808C45.6634 27.959 42.0935 28.799 39.3381 27.1963C39.3237 27.1893 39.3094 27.1787 39.295 27.1717C39.2484 27.1436 39.2017 27.1155 39.1551 27.0873C30.8386 22.1036 19.9604 24.5955 14.7653 32.6897C16.3905 29.9939 15.533 26.5039 12.8027 24.838C10.0437 23.1509 6.41643 23.9663 4.67993 26.655C4.68711 26.641 4.69787 26.6304 4.70505 26.6164C13.3552 13.0358 31.5812 8.87796 45.4624 17.299C45.4696 17.299 45.4732 17.3061 45.4804 17.3096C45.4804 17.3096 45.484 17.3096 45.4876 17.3131C48.2502 19.0072 49.0933 22.5745 47.3676 25.2843V25.2808Z"
              fill="#6B76E3"
            />
            <path
              d="M12.3502 58.6929C10.6281 61.3957 11.4604 64.949 14.2051 66.6501C14.1907 66.6431 14.18 66.6325 14.1656 66.6255C0.359754 58.1868 -3.90974 40.4344 4.5539 26.8608C4.58978 26.8011 4.62565 26.7413 4.66512 26.6816C4.67229 26.671 4.67588 26.6605 4.68306 26.6499C6.41956 23.9612 10.0468 23.1458 12.8059 24.8329C15.5326 26.4988 16.3937 29.9888 14.7684 32.6846C14.7684 32.6881 14.7684 32.6916 14.7612 32.6951C14.754 32.7092 14.7433 32.7232 14.7361 32.7373C14.7074 32.783 14.6787 32.8287 14.65 32.8744C14.65 32.8814 14.6428 32.8849 14.6392 32.8919C9.56965 41.0424 12.117 51.6883 20.3833 56.7704C17.6314 55.1678 14.0616 56.0113 12.3574 58.6859L12.3502 58.6929Z"
              fill="#F45B49"
            />
            <path
              d="M55.0521 57.2985C55.0377 57.3196 55.027 57.3407 55.0126 57.3618C46.3983 70.8861 28.2763 75.0686 14.4203 66.7775C14.3594 66.7424 14.2984 66.7072 14.2374 66.6686C14.2266 66.6615 14.2158 66.658 14.2051 66.651C11.4604 64.9499 10.628 61.3966 12.3502 58.6938C14.0544 56.0192 17.6243 55.1757 20.3761 56.7783C20.3905 56.7854 20.4048 56.7959 20.4192 56.8029C20.4658 56.8311 20.5124 56.8592 20.5591 56.8873C20.5591 56.8873 20.5663 56.8873 20.5663 56.8943C28.8862 61.8711 39.7645 59.3757 44.956 51.2744C43.32 53.9701 44.1775 57.4707 46.9078 59.1402C49.674 60.8307 53.3192 60.0083 55.0485 57.2985H55.0521Z"
              fill="#5ACA7A"
            />
            <path
              d="M55.0632 57.2746C55.0632 57.2746 55.056 57.2851 55.0524 57.2922C55.0524 57.2922 55.0524 57.2957 55.0488 57.2992C53.3195 60.0055 49.6779 60.8314 46.9081 59.1409C44.1778 57.4714 43.3203 53.9743 44.9563 51.2751C44.9635 51.261 44.9743 51.247 44.9814 51.2329C45.0101 51.1872 45.0388 51.1415 45.0675 51.0959C50.155 42.9419 47.6113 32.282 39.3342 27.1963C42.0861 28.7989 45.6595 27.9589 47.3637 25.2808C49.0895 22.571 48.2499 19.0036 45.4837 17.3096C45.5053 17.3236 45.5268 17.3342 45.5483 17.3482C59.4116 25.822 63.656 43.6764 55.0596 57.2746H55.0632Z"
              fill="#45A4F3"
            />
            <path
              d="M32.1478 54.937L26.9204 38.5587L23.7452 50.2133L20.4767 43.5917C20.4229 43.4792 20.3045 43.4089 20.179 43.4089H13.8572C13.215 43.4089 12.6804 42.9134 12.6661 42.2842C12.6661 42.2702 12.6661 42.2526 12.6661 42.2385C12.6589 41.5989 13.2043 41.0857 13.8572 41.0857H20.179C21.2158 41.0857 22.1594 41.6657 22.6115 42.5795L23.103 43.5741L26.741 30.2148L32.1442 47.1415L36.1948 34.3938L38.8821 40.5621C38.9503 40.7202 39.1117 40.8257 39.2875 40.8257H46.0398C46.682 40.8257 47.2202 41.3283 47.2166 41.9574C47.2166 41.9785 47.2166 41.9995 47.2166 42.0206C47.2094 42.6462 46.6784 43.1488 46.0362 43.1488H38.8319C37.978 43.1488 37.2102 42.6498 36.8729 41.8836L36.5357 41.1139L32.1406 54.937H32.1478Z"
              fill="currentColor"
            />
          </svg>
          <strong class="text-text-heading font-semibold">OpenObserve</strong>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";

const props = defineProps<{
  name: string;
  brandName: string;
  accentColor: string;
  logoImg: string;
  visibility: "draft" | "public" | "password";
  showUptimePercent: boolean;
  showTimelineBars: boolean;
  publicUrl: string;
  components: { name: string }[];
}>();

const { t } = useI18nTyped();

// The public page shows the brand name when set, else the page name.
const headingName = computed(
  () => props.brandName.trim() || props.name.trim() || t("statusPages.preview.untitled"),
);

// Fall back to the app's own accent when the user has not chosen one, so the
// preview never renders a broken/empty color. A runtime user-chosen hex has no
// utility class, so it rides an inline custom property (sanctioned residue).
const accentStyle = computed(() => ({
  "--sp-accent": props.accentColor.trim() || "var(--color-primary-600)",
}));

const visibilityNote = computed(() => {
  if (props.visibility === "draft") return t("statusPages.preview.draftNote");
  if (props.visibility === "password") return t("statusPages.preview.passwordNote");
  return t("statusPages.preview.publicNote");
});

const displayUrl = computed(() => props.publicUrl.replace(/^https?:\/\//, ""));

// Only named components render on the real page (blank rows are dropped at save).
const visibleComponents = computed(() => props.components.filter((c) => c.name.trim()));

// ── Sample data — deterministic per component so the preview is stable ──────
// Almost-all-green with a couple of graded cells, mirroring a healthy service.
function sampleTimeline(seed: number): string[] {
  const cells: string[] = [];
  for (let i = 0; i < 90; i++) {
    const n = (i * 7 + seed * 13) % 97;
    if (n === 3) cells.push("bg-error-500");
    else if (n === 17 || n === 61) cells.push("bg-warning-500");
    else cells.push("bg-success-500");
  }
  return cells;
}

function sampleUptime(seed: number): string {
  const base = 99.98 - (seed % 4) * 0.03;
  return base.toFixed(2);
}
</script>
