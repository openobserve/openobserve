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

<!-- The one picker every consumer form uses; it lists names and pin state, never a value or host. -->
<template>
  <OPopover
    v-model:open="open"
    side="bottom"
    align="end"
    :aria-label="t('secrets.picker.title')"
    data-test="secret-picker"
  >
    <template #trigger>
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="key"
        :aria-label="t('secrets.picker.open')"
        :data-test="`${dataTest}-trigger`"
      />
    </template>
    <div class="flex w-[min(26rem,calc(100vw-1.5rem))] flex-col gap-2 p-2">
      <OSearchInput
        v-model="search"
        :placeholder="t('secrets.picker.search')"
        data-test="secret-picker-search"
      />
      <div v-if="picker.isPending.value" class="text-text-secondary px-2 py-3 text-sm">
        {{ t("common.loading") }}
      </div>
      <OEmptyState
        v-else-if="!items.length"
        size="inline"
        icon="lock"
        :title="fgaOff ? t('secrets.picker.emptyFgaOff') : t('secrets.picker.empty')"
        data-test="secret-picker-empty"
      />
      <template v-else>
        <template v-for="group in groups" :key="group.id">
          <span v-if="group.items.length" class="text-text-secondary px-2 pt-1 text-xs">
            {{ group.label }}
          </span>
          <OButton
            v-for="item in group.items"
            :key="item.id"
            variant="ghost"
            size="sm"
            class="w-full justify-start"
            :disabled="isDisabled(item)"
            :title="disabledReason(item)"
            :data-test="`secret-picker-item-${item.name}`"
            @click="pick(item)"
          >
            <OIcon
              :name="item.kind === 'secret' ? 'lock' : 'data-object'"
              size="sm"
              class="shrink-0"
            />
            <OTruncatedText class="min-w-0 flex-1 text-start font-mono">{{
              item.name
            }}</OTruncatedText>
            <OTag
              v-if="badge(item)"
              size="xs"
              shape="rounded"
              :variant="badge(item)!.variant"
              icon=""
              :label="badge(item)!.label"
              :data-test="`secret-picker-item-${item.name}-badge`"
            />
            <OTag
              v-if="privateLocationsHere(item)"
              size="xs"
              shape="rounded"
              variant="amber-soft"
              icon="location-on"
              :label="t('secrets.badges.privateLocations')"
              :data-test="`secret-picker-item-${item.name}-private-locations`"
            />
          </OButton>
        </template>
      </template>
      <div class="border-border-default flex items-center gap-2 border-t px-2 pt-2 text-xs">
        <OIcon name="info" size="xs" class="text-text-secondary shrink-0" />
        <span class="text-text-secondary flex-1">{{ t("secrets.picker.hiddenHint") }}</span>
        <router-link
          :to="{ name: 'secrets', query: { org_identifier: orgId } }"
          class="text-text-link"
          data-test="secret-picker-manage-link"
          >{{ t("secrets.title") }}</router-link
        >
      </div>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import { refDebounced } from "@vueuse/core";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { ConsumerType, SecretPickerItem } from "@/services/secrets";
import { secretPickerQuery, secretStoreStatusQuery } from "@/services/secrets.queries";
import { pickerDisabled, pickerState } from "./secretRefs";

const props = withDefaults(
  defineProps<{
    consumerType: ConsumerType;
    consumerId?: string;
    dataTest?: string;
    /** Toolsets hand the value to an agent in clear, so a pick needs manage (V37). */
    requireManage?: boolean;
    /** A synthetics check's current locations; a private one changes what is allowed here. */
    locations?: string[];
  }>(),
  { consumerId: "", dataTest: "secret-picker", requireManage: false, locations: () => [] },
);
const emit = defineEmits<{ pick: [item: SecretPickerItem] }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
// Optional so a host can open the picker from its own control, such as the field it fills.
const open = defineModel<boolean>("open", { default: false });
const search = ref("");

const query = refDebounced(
  computed(() => search.value.trim()),
  300,
);
const picker = useQuery(() =>
  Object.assign(
    secretPickerQuery(
      orgId.value,
      props.consumerType,
      props.consumerId,
      query.value,
      props.locations,
    ),
    {
      enabled: open.value && !!orgId.value,
      placeholderData: keepPreviousData,
    },
  ),
);
const status = useQuery(() =>
  Object.assign(secretStoreStatusQuery(orgId.value), { enabled: open.value && !!orgId.value }),
);
const fgaOff = computed(() => status.data.value?.fga === "off");

const items = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (picker.data.value ?? []).filter((i) => !q || i.name.toLowerCase().includes(q));
});
const groups = computed(() => [
  {
    id: "secrets",
    label: t("secrets.picker.secretsHere"),
    items: items.value.filter((i) => i.kind === "secret"),
  },
  {
    id: "variables",
    label: t("secrets.tabVariables"),
    items: items.value.filter((i) => i.kind === "variable"),
  },
]);

const badge = (item: SecretPickerItem): { label: I18nText; variant: BadgeVariant } | null => {
  switch (pickerState(item)) {
    case "not-allowed":
      return { label: t("secrets.picker.notAllowed"), variant: "default-soft" };
    case "any-host":
      return { label: t("secrets.badges.anyHost"), variant: "error-soft" };
    case "pin-on-first-use":
      return { label: t("secrets.picker.pinOnFirstUse"), variant: "warning-soft" };
    case "legacy":
      return { label: t("secrets.badges.legacyNoPin"), variant: "warning-soft" };
    default:
      return item.kind === "secret"
        ? { label: t("secrets.picker.pinned"), variant: "success-soft" }
        : null;
  }
};

// Only a check can run on a customer-run private location (V41).
const privateLocationsHere = (item: SecretPickerItem) =>
  props.consumerType === "synthetics_check" &&
  item.kind === "secret" &&
  item.private_locations === "on";

const lacksManage = (item: SecretPickerItem) =>
  props.requireManage && item.kind === "secret" && item.rights?.manage === false;
const isDisabled = (item: SecretPickerItem) => pickerDisabled(item) || lacksManage(item);

const disabledReason = (item: SecretPickerItem): I18nText | undefined => {
  if (!pickerDisabled(item)) return lacksManage(item) ? t("secrets.picker.needsManage") : undefined;
  return pickerState(item) === "any-host"
    ? t("secrets.picker.anyHostNeedsManageAccess")
    : t("secrets.picker.notAllowedReason");
};

const pick = (item: SecretPickerItem) => {
  if (isDisabled(item)) return;
  emit("pick", item);
  open.value = false;
  search.value = "";
};
</script>
