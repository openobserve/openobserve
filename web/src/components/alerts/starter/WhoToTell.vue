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

<!-- One "Who to tell" line: what is chosen, a guess the user must accept, and the alert form's own picker. -->
<template>
  <div class="flex min-w-0 flex-col gap-1" data-test="alerts-who-to-tell">
    <div class="flex min-h-8.5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span v-if="!bare" class="text-text-heading me-2 text-sm font-medium">{{
        t("alertStarter.whoToTell.label")
      }}</span>
      <span v-if="nobody" class="text-text-heading text-sm" data-test="alerts-who-to-tell-no-one">{{
        t("alertStarter.whoToTell.noOne")
      }}</span>
      <OBadge
        v-for="name in shownChips"
        :key="name"
        variant="default-outline"
        shape="rounded"
        removable
        :remove-label="t('alertStarter.whoToTell.remove', { name })"
        data-test="alerts-who-to-tell-chip"
        @remove="remove(name)"
        >{{ name }}</OBadge
      >
      <OButton
        v-if="hiddenCount > 0"
        variant="link"
        size="xs"
        data-test="alerts-who-to-tell-more"
        @click="open = true"
        >{{ t("alertStarter.whoToTell.more", { count: hiddenCount }, hiddenCount) }}</OButton
      >
      <OBadge
        v-if="workflowCount > 0"
        variant="default-outline"
        shape="rounded"
        data-test="alerts-who-to-tell-workflows"
        >{{
          t("alert_dependencies.countWorkflow", { count: workflowCount }, workflowCount)
        }}</OBadge
      >
      <OBadge
        v-if="hasOncall"
        variant="default-outline"
        shape="rounded"
        data-test="alerts-who-to-tell-oncall"
        >{{ t("alerts.alertSettings.oncallTeamTarget") }}</OBadge
      >
      <OPopover
        v-model:open="open"
        side="bottom"
        align="start"
        :aria-label="t('alertStarter.whoToTell.pickLabel')"
      >
        <template #trigger>
          <OButton variant="outline" size="chip" data-test="alerts-who-to-tell-pick">{{
            t("alertStarter.whoToTell.pick")
          }}</OButton>
        </template>
        <div class="w-[min(34rem,calc(100vw-1.5rem))]" data-test="alerts-who-to-tell-picker">
          <AlertDestinationsField
            setting-row
            list
            wrap
            tooltip=""
            :destinations="modelValue"
            :workflows="workflows ?? []"
            :supports-workflows="workflows !== undefined"
            :destination-options="destinationNames"
            :destination-details="destinationDetails"
            :oncall-team="oncallTeam"
            :placeholder="t('alerts.summary.noDestination')"
            @update:destinations="emit('update:modelValue', $event)"
            @update:workflows="emit('update:workflows', $event)"
            @refresh="destinationList.refetch()"
          />
        </div>
      </OPopover>
    </div>
    <!-- The guess has a line of its own, held from its skeleton until the alert is done, so using it moves nothing. -->
    <div
      v-if="guessLine"
      class="flex min-h-7 min-w-0 items-center"
      data-test="alerts-who-to-tell-guess-line"
    >
      <OSkeleton
        v-if="nobody && pending"
        animation="none"
        class="h-7 w-72 max-w-full"
        aria-hidden="true"
        data-test="alerts-who-to-tell-guess-pending"
      />
      <span
        v-else-if="shownGuess"
        class="rounded-default border-border-default flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 border px-2 py-0.5"
        data-test="alerts-who-to-tell-guess"
      >
        <OTruncatedText class="text-text-body min-w-0 font-mono text-xs">{{
          shownGuess.name
        }}</OTruncatedText>
        <OBadge variant="default-soft" size="sm" data-test="alerts-who-to-tell-guess-tag">{{
          t(
            "alertStarter.whoToTell.guessed",
            { count: shownGuess.alertCount },
            shownGuess.alertCount,
          )
        }}</OBadge>
        <OButton
          v-if="!usedGuess"
          variant="link"
          size="xs"
          :aria-label="t('alertStarter.whoToTell.useName', { name: shownGuess.name })"
          data-test="alerts-who-to-tell-guess-use"
          @click="useGuess(shownGuess.name)"
          >{{ t("alertStarter.whoToTell.use") }}</OButton
        >
        <span
          v-else
          class="text-text-secondary text-xs"
          data-test="alerts-who-to-tell-guess-used"
          >{{ t("alertStarter.whoToTell.inUse") }}</span
        >
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import AlertDestinationsField from "@/components/alerts/AlertDestinationsField.vue";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { describeDestinations } from "@/utils/alerts/destinationDescription";
import { hasDeliveryTarget } from "@/utils/alerts/deliveryTarget";
import { useDestinationGuess } from "@/composables/alerts/useDestinationGuess";

const MAX_CHIPS = 3;

const props = withDefaults(
  defineProps<{
    /** Destination names. */
    modelValue: string[];
    streamType?: string;
    streamName?: string;
    /** Workflow ids; when given, the picker offers workflows too. */
    workflows?: string[];
    /** The alert's on-call team, so a line with only that target does not read "No one yet". */
    oncallTeam?: string | null;
    /** The host row already says "Who to tell". */
    bare?: boolean;
  }>(),
  { streamType: undefined, streamName: undefined, workflows: undefined, oncallTeam: null },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string[]): void;
  (e: "update:workflows", value: string[]): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const open = ref(false);

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
// The same read the alert form's picker uses for its usage counts, so both share one cache entry.
const destinationList = useQuery(() => ({
  ...destinationsQuery(org.value, "alert", true),
  enabled: !!org.value,
}));
const destinationNames = computed<string[]>(() =>
  (destinationList.data.value ?? []).map((d: { name?: string }) => d?.name ?? ""),
);
const destinationDetails = computed(() =>
  describeDestinations(destinationList.data.value ?? [], t),
);

const { guess, pending } = useDestinationGuess(
  () => props.streamType,
  () => props.streamName,
);

const workflowCount = computed(() => props.workflows?.length ?? 0);
const hasOncall = computed(() => hasDeliveryTarget({ oncall_team: props.oncallTeam }));
const nobody = computed(
  () =>
    !hasDeliveryTarget({
      destinations: props.modelValue,
      workflows: props.workflows,
      oncall_team: props.oncallTeam,
    }),
);
const shownChips = computed(() => props.modelValue.slice(0, MAX_CHIPS));
const hiddenCount = computed(() => Math.max(0, props.modelValue.length - MAX_CHIPS));
// A guess is only offered while nobody is told; it never applies itself, and stays shown once used.
const usedName = ref<string | null>(null);
const usedGuess = computed(() =>
  !nobody.value &&
  guess.value &&
  guess.value.name === usedName.value &&
  props.modelValue.includes(usedName.value)
    ? guess.value
    : null,
);
const useGuess = (name: string) => {
  usedName.value = name;
  emit("update:modelValue", [name]);
};
const shownGuess = computed(() => (nobody.value ? guess.value : usedGuess.value));
const guessLine = computed(() => (nobody.value && pending.value) || !!shownGuess.value);

const remove = (name: string) =>
  emit(
    "update:modelValue",
    props.modelValue.filter((n) => n !== name),
  );
</script>
