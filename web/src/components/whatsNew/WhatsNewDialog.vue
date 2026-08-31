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
  <ODialog
    v-model:open="carouselOpen"
    size="xl"
    bleed
    :title="t('whatsNew.title')"
    data-test="whats-new-dialog"
    @update:open="handleOpenChange"
  >
    <template #header-left>
      <OBadge v-if="headerVersion" variant="primary-soft" size="sm" shape="rounded">
        {{ raw(`v${headerVersion}`) }}
      </OBadge>
    </template>

    <div class="flex h-125" @keydown="handleKeydown">
      <!-- Contents rail — doubles as the overview, so nobody has to page
           through to find out what is in the release. -->
      <nav
        class="border-border-default bg-surface-panel w-60 shrink-0 overflow-y-auto border-e p-2"
        :aria-label="t('whatsNew.contents')"
      >
        <button
          v-for="(entry, index) in railEntries"
          :key="entry.key"
          type="button"
          class="rounded-default mb-0.5 flex w-full items-center gap-2.5 px-2.5 py-2 text-start transition-colors"
          :class="
            index === slideIndex
              ? 'bg-surface-accent-active text-accent font-medium'
              : 'text-text-secondary hover:bg-surface-subtle hover:text-text-heading'
          "
          :aria-current="index === slideIndex"
          :data-test="`whats-new-rail-${index}`"
          @click="goToSlide(index)"
        >
          <OIcon :name="entry.icon" size="xs" class="shrink-0" />
          <span class="min-w-0 flex-1 truncate text-sm">{{ entry.label }}</span>
          <OIcon
            v-if="entry.enterpriseOnly"
            name="workspace-premium"
            size="xs"
            class="text-accent shrink-0"
          />
        </button>
      </nav>

      <!-- Only the active slide is ever in the DOM; a translated track would
           need an inline transform, which the design rules disallow. -->
      <div class="min-w-0 flex-1 overflow-y-auto" data-test="whats-new-pane">
        <Transition
          mode="out-in"
          enter-active-class="animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          leave-active-class="animate-out fade-out-0 duration-100 motion-reduce:animate-none"
        >
          <!-- ── Cover ───────────────────────────────────────────── -->
          <div v-if="slide?.kind === 'cover'" :key="`cover-${slideIndex}`">
            <div
              class="bg-surface-accent-hover border-border-default flex flex-col items-start gap-3 border-b px-8 py-10"
            >
              <OBadge variant="success-soft" size="sm" icon="check-circle">
                {{ t("whatsNew.justUpdated") }}
              </OBadge>
              <div class="text-text-heading font-mono text-4xl font-semibold tabular-nums">
                {{ raw(`v${slide.release.version}`) }}
              </div>
              <OText variant="page-title" as="h2" class="text-text-heading max-w-xl text-xl">
                {{ slide.release.title }}
              </OText>
            </div>

            <div class="flex flex-col gap-5 px-8 py-6">
              <div
                class="prose prose-sm text-text-secondary max-w-none"
                :class="isDark && 'prose-invert'"
                v-html="renderNotes(slide.release.summary)"
              />

              <div class="flex flex-wrap gap-8">
                <div>
                  <div class="text-text-heading text-2xl leading-tight font-semibold tabular-nums">
                    {{ slide.highlightCount }}
                  </div>
                  <OText variant="label" class="text-text-muted tracking-wider uppercase">
                    {{ t("whatsNew.changesForYou") }}
                  </OText>
                </div>
                <div>
                  <div class="text-text-heading text-2xl leading-tight font-semibold tabular-nums">
                    {{ slide.span.length }}
                  </div>
                  <OText variant="label" class="text-text-muted tracking-wider uppercase">
                    {{ t("whatsNew.releasesApplied") }}
                  </OText>
                </div>
                <div>
                  <div class="text-text-heading text-2xl leading-tight font-semibold tabular-nums">
                    {{ formatDate(slide.release.date) }}
                  </div>
                  <OText variant="label" class="text-text-muted tracking-wider uppercase">
                    {{ t("whatsNew.released") }}
                  </OText>
                </div>
              </div>

              <!-- A multi-version jump names what was skipped rather than
                   replaying a separate carousel for each release. -->
              <div v-if="slide.span.length > 1" class="flex flex-col gap-2">
                <OText variant="label" class="text-text-muted tracking-wider uppercase">
                  {{ t("whatsNew.alsoIncludes") }}
                </OText>
                <div
                  v-for="skipped in slide.span.slice(1)"
                  :key="skipped.version"
                  class="border-border-default flex items-baseline gap-3 border-s-2 ps-3"
                >
                  <span class="text-accent shrink-0 font-mono text-xs font-semibold tabular-nums">
                    {{ raw(`v${skipped.version}`) }}
                  </span>
                  <span class="text-text-secondary min-w-0 text-sm">{{ skipped.title }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Highlight ───────────────────────────────────────── -->
          <div v-else-if="slide?.kind === 'highlight'" :key="`highlight-${slide.highlight.id}`">
            <!-- A media 404 drops to the icon band rather than a broken glyph,
                 so every highlight keeps a visual anchor either way. -->
            <div
              v-if="mediaFor(slide.highlight)"
              class="border-border-default bg-surface-subtle aspect-video w-full overflow-hidden border-b"
            >
              <img
                :src="mediaFor(slide.highlight)"
                :alt="slide.highlight.media?.alt"
                class="size-full object-cover"
                :data-test="`whats-new-media-${slide.highlight.id}`"
                @error="markMediaFailed(slide.highlight.id)"
              />
            </div>
            <div
              v-else
              class="bg-surface-accent-hover border-border-default text-accent flex h-32 items-center justify-center border-b"
            >
              <OIcon :name="slide.highlight.icon" size="xl" />
            </div>

            <div class="flex flex-col gap-3 px-8 py-6">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-accent font-mono text-xs font-semibold tabular-nums">
                  {{ raw(`v${slide.version}`) }}
                </span>
                <OBadge
                  v-if="editionLabel(slide.highlight)"
                  variant="primary-outline"
                  size="xs"
                  shape="rounded"
                  icon="workspace-premium"
                >
                  {{ editionLabel(slide.highlight) }}
                </OBadge>
              </div>

              <OText variant="page-title" as="h2" class="text-text-heading text-xl">
                {{ slide.highlight.title }}
              </OText>

              <div
                class="prose prose-sm text-text-secondary max-w-none"
                :class="isDark && 'prose-invert'"
                :data-test="`whats-new-body-${slide.highlight.id}`"
                v-html="renderNotes(slide.highlight.body)"
              />

              <OButton
                v-if="slide.highlight.docsUrl"
                as="a"
                :href="slide.highlight.docsUrl"
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                size="sm-action"
                icon-right="open-in-new"
                class="mt-1 self-start"
                :data-test="`whats-new-docs-${slide.highlight.id}`"
              >
                {{ t("whatsNew.readTheDocs") }}
              </OButton>
            </div>
          </div>

          <!-- ── Outro ───────────────────────────────────────────── -->
          <div
            v-else-if="slide?.kind === 'outro'"
            :key="`outro-${slideIndex}`"
            class="flex h-full flex-col items-start justify-center gap-4 px-8"
          >
            <div
              class="bg-status-positive/12 text-status-positive border-status-positive/28 flex size-14 items-center justify-center rounded-full border"
            >
              <OIcon name="check-circle" size="lg" />
            </div>

            <OText variant="page-title" as="h2" class="text-text-heading text-xl">
              {{ t("whatsNew.outroTitle") }}
            </OText>
            <OText variant="body" class="text-text-secondary max-w-md leading-relaxed">
              {{ t("whatsNew.outroBody") }}
            </OText>

            <OButton
              as="a"
              :href="slide.release.url"
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
              size="sm-action"
              icon-right="open-in-new"
              data-test="whats-new-full-notes"
            >
              {{ t("whatsNew.fullReleaseNotes") }}
            </OButton>
          </div>
        </Transition>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-4">
        <OText variant="meta" class="text-text-muted tabular-nums">
          {{ t("whatsNew.slideCount", { current: slideIndex + 1, total: slides.length }) }}
        </OText>

        <div class="flex items-center gap-2">
          <OButton
            v-if="!isLastSlide"
            variant="ghost"
            size="sm-action"
            data-test="whats-new-skip"
            @click="dismiss"
          >
            {{ t("whatsNew.skip") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="isFirstSlide"
            data-test="whats-new-back"
            @click="previousSlide"
          >
            {{ t("whatsNew.back") }}
          </OButton>
          <OButton
            v-if="!isLastSlide"
            variant="primary"
            size="sm-action"
            data-test="whats-new-next"
            @click="nextSlide"
          >
            {{ t("whatsNew.next") }}
          </OButton>
          <OButton
            v-else
            variant="primary"
            size="sm-action"
            data-test="whats-new-done"
            @click="dismiss"
          >
            {{ t("whatsNew.done") }}
          </OButton>
        </div>
      </div>
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import { useTheme } from "@/composables/useTheme";
import { useWhatsNew } from "@/composables/useWhatsNew";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { ReleaseHighlight } from "@/types/whatsNew";

import { renderNotes } from "./notesMarkdown";

interface RailEntry {
  key: string;
  label: I18nText;
  icon: IconName;
  enterpriseOnly: boolean;
}

const { t } = useI18nTyped();
const { isDark } = useTheme();
const {
  carouselOpen,
  closeCarousel,
  currentSlide,
  goToSlide,
  isFirstSlide,
  isLastSlide,
  nextSlide,
  previousSlide,
  slideIndex,
  slides,
} = useWhatsNew();

const slide = currentSlide;
const failedMedia = ref<Set<string>>(new Set());

const headerVersion = computed(() => {
  const current = slide.value;
  if (!current) return "";
  return current.kind === "highlight" ? current.version : current.release.version;
});

/** One rail row per slide, in the same order — the index IS the slide index. */
const railEntries = computed<RailEntry[]>(() =>
  slides.value.map((entry, index) => {
    if (entry.kind === "cover") {
      return {
        key: `cover-${index}`,
        label: t("whatsNew.overview"),
        icon: "auto-awesome" as IconName,
        enterpriseOnly: false,
      };
    }
    if (entry.kind === "outro") {
      return {
        key: `outro-${index}`,
        label: t("whatsNew.outroTitle"),
        icon: "check-circle" as IconName,
        enterpriseOnly: false,
      };
    }
    return {
      key: entry.highlight.id,
      label: entry.highlight.title,
      icon: entry.highlight.icon,
      enterpriseOnly: !entry.highlight.editions.includes("oss"),
    };
  }),
);

/** Resolved shot for the active theme, or empty once it has failed to load. */
const mediaFor = (highlight: ReleaseHighlight): string => {
  if (!highlight.media || failedMedia.value.has(highlight.id)) return "";
  return isDark.value ? highlight.media.dark : highlight.media.light;
};

const markMediaFailed = (id: string) => {
  failedMedia.value = new Set(failedMedia.value).add(id);
};

/** Only narrower-than-everywhere availability earns a badge. */
const editionLabel = (highlight: ReleaseHighlight) => {
  if (highlight.editions.length >= 3) return "";
  if (!highlight.editions.includes("oss")) return t("whatsNew.editionEnterprise");
  return "";
};

const formatDate = (iso: string) =>
  raw(
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
  );

const dismiss = () => closeCarousel();

/** Closing by any route (×, Escape, scrim) still acknowledges the version. */
const handleOpenChange = (open: boolean) => {
  if (!open) closeCarousel();
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === "ArrowRight") nextSlide();
  else if (event.key === "ArrowLeft") previousSlide();
};
</script>
