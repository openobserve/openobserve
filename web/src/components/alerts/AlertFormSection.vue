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
import { computed, provide } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { SETTING_ROW_BARE_KEY } from "@/lib/core/SettingRow/OSettingRow.types";
import { ALERT_SECTIONS, type AlertSectionDef, type AlertSectionId } from "./alertFormSections";

const props = withDefaults(
  defineProps<{
    id: AlertSectionId;
    /** The steps this alert type has, in order; numbering and Back/Next follow it. */
    sections?: readonly AlertSectionDef[];
    title: I18nText;
    /** One sentence under the title. */
    help: I18nText;
    /** False while another section is in view: its step buttons fade out but stay in the Tab order. */
    current?: boolean;
    /** False when the previous section cannot be opened from here, as section 1 of an edit. */
    canGoBack?: boolean;
  }>(),
  { sections: () => ALERT_SECTIONS, current: undefined, canGoBack: true },
);

const emit = defineEmits<{
  /** The header arrows: scroll to the section and put the Tab start on its heading. */
  go: [id: AlertSectionId];
  /** The footer buttons: scroll to the section and focus its first control. */
  step: [id: AlertSectionId];
}>();

const { t } = useI18nTyped();
const total = computed(() => props.sections.length);
const index = computed(() => props.sections.findIndex((section) => section.id === props.id) + 1);
const def = computed(() => props.sections[index.value - 1]);
const previous = computed(() => props.sections[index.value - 2]);
const next = computed(() => props.sections[index.value]);
const previousLabel = computed(() =>
  previous.value
    ? t("alerts.sections.back", { title: t(previous.value.navKey) })
    : t("alerts.sections.previousStep"),
);
const nextLabel = computed(() =>
  next.value
    ? t("alerts.sections.next", { title: t(next.value.navKey) })
    : t("alerts.sections.nextStep"),
);
const footerBack = computed(() => (props.canGoBack ? previous.value : undefined));

// The key also tells nested steps to drop their own card; the body restores the S4 rule and padding.
provide(SETTING_ROW_BARE_KEY, true);
</script>

<!-- The header band is the sticky header (data-snap-sticky), so a stuck card shows one header, never two. -->
<template>
  <section
    :data-snap-section="id"
    :data-test="`add-alert-section-${id}`"
    class="flex flex-col px-4 py-2 max-lg:px-3 [&_[data-snap-stop]]:scroll-mt-28"
  >
    <div v-if="$slots.lead" class="px-1 pb-2" :data-test="`add-alert-section-${id}-lead`">
      <slot name="lead" />
    </div>
    <div
      class="bg-surface-overlay border-border-default rounded-surface flex flex-col border"
      :data-test="`add-alert-section-${id}-card`"
    >
      <header
        data-snap-sticky
        class="bg-surface-subtle border-border-default rounded-t-surface sticky top-0 z-30 flex items-start gap-3 border-b px-4 py-2 max-lg:static max-lg:z-auto"
      >
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="text-text-secondary text-xs" :data-test="`add-alert-section-${id}-eyebrow`">
            {{
              def?.optional
                ? t("alerts.sections.eyebrowOptional", { n: index, total })
                : t("alerts.sections.eyebrow", { n: index, total })
            }}
          </span>
          <h2
            class="text-text-heading m-0 text-sm font-semibold focus:outline-none"
            tabindex="-1"
            data-snap-heading
            :data-test="`add-alert-section-${id}-title`"
          >
            {{ title }}
          </h2>
          <p
            class="text-text-secondary text-compact m-0"
            :data-test="`add-alert-section-${id}-help`"
          >
            {{ help }}
          </p>
        </div>
        <div
          class="flex shrink-0 gap-1"
          :class="current === false && 'opacity-0 focus-within:opacity-100'"
          :data-test="`add-alert-section-${id}-steps`"
        >
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="keyboard-arrow-up"
            :disabled="!previous"
            :aria-label="previousLabel"
            :data-test="`add-alert-section-${id}-prev`"
            @click="previous && emit('go', previous.id)"
          >
            <OTooltip v-if="previous" side="bottom" :content="previousLabel" />
          </OButton>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="keyboard-arrow-down"
            :disabled="!next"
            :aria-label="nextLabel"
            :data-test="`add-alert-section-${id}-next`"
            @click="next && emit('go', next.id)"
          >
            <OTooltip v-if="next" side="bottom" :content="nextLabel" />
          </OButton>
        </div>
      </header>
      <div
        class="[&_[data-o-setting-row]]:border-border-default -mt-px flex flex-col px-4 pb-2 [&_[data-o-setting-row]]:border-t [&_[data-o-setting-row]]:py-3"
        data-section-body
      >
        <slot />
      </div>
      <div
        v-if="$slots.optional"
        class="bg-surface-panel border-border-default hidden flex-col border-t px-4 py-1.5 has-[>:not(:empty):not([style*='display:_none'])]:flex"
        :data-test="`add-alert-section-${id}-optional`"
      >
        <slot name="optional" />
      </div>
      <footer
        class="border-border-default rounded-b-surface flex flex-wrap items-center gap-2 border-t px-4 py-1.5 max-md:flex-col max-md:items-stretch"
        :data-test="`add-alert-section-${index}-footer`"
      >
        <OButton
          v-if="footerBack"
          variant="ghost"
          size="sm"
          icon-left="arrow-upward"
          :data-test="`add-alert-section-${index}-back`"
          @click="emit('step', footerBack.id)"
        >
          {{ previousLabel }}
        </OButton>
        <OButton
          v-if="next"
          class="ms-auto max-md:ms-0"
          variant="outline"
          size="sm"
          icon-right="arrow-downward"
          :data-test="`add-alert-section-${index}-next`"
          @click="emit('step', next.id)"
        >
          {{ nextLabel }}
        </OButton>
      </footer>
    </div>
  </section>
</template>
