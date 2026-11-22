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
  <ODropdown v-if="crossLinks.length > 0" side="bottom" align="end">
    <template #trigger>
      <OButton
        variant="outline"
        size="icon-toolbar"
        icon-left="open-in-new"
        :aria-label="t('common.crossLinks')"
        data-test="session-cross-links-btn"
      >
        <OTooltip :content="t('common.crossLinks')" side="bottom" />
      </OButton>
    </template>
    <ODropdownItem
      v-for="(crossLink, index) in crossLinks"
      :key="`${crossLink.name}-${index}`"
      :data-test="`session-cross-link-${crossLink.name}`"
      icon-left="open-in-new"
      @select="open(crossLink)"
    >
      {{ crossLink.name }}
    </ODropdownItem>
  </ODropdown>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { CrossLink } from "@/composables/useLogs/searchState";
import { matchCrossLinks, openCrossLink, resolveCrossLinkUrl } from "@/utils/crossLinking";

const props = defineProps<{
  fieldName: string;
  fieldValue: unknown;
  range: () => { start: number; end: number };
}>();

const store = useStore();
const { t } = useI18nTyped();

const crossLinks = computed(() => {
  if (!store.state.zoConfig?.enable_cross_linking) return [];
  if (props.fieldValue == null || props.fieldValue === "") return [];

  const rawLinks: CrossLink[] =
    store.state.organizationData.organizationSettings?.cross_links ?? [];
  // A stored alias must not redirect this field, so each field is its own alias.
  const orgLinks = rawLinks.map((link) =>
    link.fields?.length
      ? { ...link, fields: link.fields.map((f) => ({ name: f.name, alias: f.name })) }
      : link,
  );
  const matched = new Set(matchCrossLinks({ org_links: orgLinks }, props.fieldName).links);

  // A link with no fields is always shown.
  return orgLinks.filter((link) => !link.fields?.length || matched.has(link));
});

// Resolved on selection: the range's upper bound moves while a session is live.
const open = (link: CrossLink) => {
  const { start, end } = props.range();
  openCrossLink(
    resolveCrossLinkUrl(link.url, {
      fieldName: props.fieldName,
      fieldValue: props.fieldValue,
      startTime: start,
      endTime: end,
      // A session page has no query, so ${query} and ${query_encoded} resolve to empty.
      query: "",
    }),
  );
};
</script>
