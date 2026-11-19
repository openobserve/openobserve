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
  <article
    class="rounded-default bg-surface-base border-border-default hover:border-border-strong flex min-w-0 cursor-pointer flex-col gap-1 border p-3"
    :data-test="`add-alert-suggestion-card-${suggestion.id}`"
    @click="emit('open')"
  >
    <div class="flex min-w-0 items-center gap-2">
      <OTag
        v-if="suggestion.severity"
        type="severity"
        size="xs"
        :value="severityBadgeValue(suggestion.severity)"
        :label="severityLabel(t, suggestion.severity)"
        class="shrink-0"
      />
      <h3 class="m-0 min-w-0 flex-1 text-sm leading-snug font-medium">
        <button
          type="button"
          class="text-text-heading focus-visible:ring-accent/40 rounded-default w-full cursor-pointer text-left outline-none focus-visible:ring-2"
          :data-test="`add-alert-suggestion-card-title-${suggestion.id}`"
          @click.stop="emit('open')"
        >
          <OTruncatedText>{{ raw(suggestion.title) }}</OTruncatedText>
        </button>
      </h3>
    </div>
    <OTruncatedText
      v-if="suggestion.sentence"
      as="p"
      :lines="2"
      class="text-text-secondary m-0 text-xs"
      >{{ raw(inThresholdUnit(suggestion.sentence, suggestion.prefill)) }}</OTruncatedText
    >
    <p
      class="m-0 flex min-w-0 items-center gap-1 text-xs"
      :class="lacks ? 'text-status-warning-text' : 'text-text-secondary'"
    >
      <OIcon
        :name="lacks ? 'warning' : fit.fit === 'fits' ? 'check-circle' : 'help-outline'"
        size="xs"
        class="shrink-0"
        :class="fit.fit === 'fits' ? 'text-status-positive' : ''"
      />
      <OTruncatedText class="min-w-0" data-test="add-alert-suggestion-card-why">{{
        whyLine
      }}</OTruncatedText>
    </p>
    <p
      v-if="suggestion.stream_swap"
      class="text-text-secondary m-0 text-xs"
      data-test="add-alert-suggestion-card-swap"
    >
      <OTruncatedText>{{
        t("alerts.librarySuggest.swap", {
          from: raw(suggestion.stream_swap.written_for),
          to: raw(suggestion.stream_swap.will_use),
        })
      }}</OTruncatedText>
    </p>
    <div
      v-if="setUp"
      class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
      data-test="add-alert-suggestion-card-set-up"
    >
      <OTruncatedText class="text-text-body min-w-0" :lines="2">{{ setUpText }}</OTruncatedText>
      <OButton
        variant="link"
        size="xs"
        :data-test="`add-alert-suggestion-card-open-${suggestion.id}`"
        @click.stop="emit('open-existing', setUp)"
        >{{ t("alerts.librarySuggest.open") }}</OButton
      >
      <OButton
        variant="link"
        size="xs"
        :data-test="`add-alert-suggestion-card-add-${suggestion.id}`"
        @click.stop="emit('open')"
        >{{ t("alerts.librarySuggest.addAnother") }}</OButton
      >
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { severityBadgeValue, severityLabel } from "@/components/alertLibrary/libraryFacets";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { joinListMore } from "@/utils/alerts/alertCopy";
import { cardFit } from "@/composables/alerts/useAlertLibrary";
import { inThresholdUnit } from "@/utils/alerts/lookAlike";
import type { AlreadySetUp, LibrarySuggestion } from "@/utils/alerts/librarySuggest.types";

const props = defineProps<{
  suggestion: LibrarySuggestion;
  /** Fields and metrics of the picked stream; empty while its schema is unread. */
  onStream: ReadonlySet<string>;
  /** Both comparisons when the installed copy alerts at another value than this card. */
  setUpComparison?: { installed: I18nText; suggested: I18nText };
}>();
const emit = defineEmits<{
  (e: "open"): void;
  (e: "open-existing", alert: AlreadySetUp): void;
}>();

const { t } = useI18nTyped();

const setUp = computed(() => props.suggestion.already_set_up[0]);
// An edited copy says so; a copy at another value names that value, so "> 80 %" never sits beside a 90 alert unexplained.
const setUpText = computed<I18nText>(() => {
  const name = joinListMore(
    props.suggestion.already_set_up.map((a) => a.name),
    t,
    1,
  );
  if (setUp.value?.matched_by === "pack_tag")
    return t("alerts.librarySuggest.alreadySetUpEdited", { name });
  if (props.setUpComparison)
    return t("alerts.librarySuggest.alreadySetUpAt", { ...props.setUpComparison, name });
  return t("alerts.librarySuggest.alreadySetUp", { name });
});

const fit = computed(() => cardFit(props.suggestion, props.onStream));
const lacks = computed(() => fit.value.absent.length > 0 || props.suggestion.missing.length > 0);

// "Fits your data" names what it uses; anything the stream lacks is named instead, in amber.
const whyLine = computed<I18nText>(() => {
  const s = props.suggestion;
  const label = t(
    fit.value.fit === "fits" ? "alerts.librarySuggest.fits" : "alerts.librarySuggest.likely",
  );
  const detail = fit.value.absent.length
    ? t("alerts.librarySuggest.missingFields", { fields: joinListMore(fit.value.absent, t) })
    : s.missing.length
      ? t("alerts.librarySuggest.missingLabel", { label: joinListMore(s.missing, t) })
      : s.matched_fields.length
        ? t("alerts.librarySuggest.uses", { fields: joinListMore(s.matched_fields, t) })
        : null;
  return detail ? t("alerts.intent.cardWhy", { fit: label, detail }) : label;
});
</script>
