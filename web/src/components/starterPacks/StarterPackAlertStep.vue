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
import { computed } from "vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

export interface AlertStepDestination {
  name: string;
  label: I18nText;
}

const props = defineProps<{
  /** Alerts the setup will create. */
  count: number;
  /** Alert destinations the select offers; null while they load. */
  destinations: AlertStepDestination[] | null;
  /** The server is known to have no SMTP, so Email me cannot be offered. */
  smtpOff: boolean;
  email: string;
}>();
const turnOn = defineModel<boolean>("turnOn", { default: false });
const sendTo = defineModel<boolean>("sendTo", { default: false });
const destination = defineModel<string>("destination", { default: "" });

const { t } = useI18nTyped();

const mode = computed<"loading" | "select" | "email" | "none">(() => {
  if (props.destinations === null) return "loading";
  if (props.destinations.length) return "select";
  return props.smtpOff ? "none" : "email";
});
const options = computed(() =>
  (props.destinations ?? []).map(({ name, label }) => ({ label, value: name })),
);
const isFirst = computed(() => destination.value === props.destinations?.[0]?.name);
const historyOnly = computed(() => turnOn.value && (!sendTo.value || mode.value === "none"));
const pickDestination = (value: unknown) => {
  if (typeof value === "string") destination.value = value;
};
</script>

<template>
  <div class="flex flex-col gap-3 py-3 ps-13 pe-3 text-sm" data-test="starter-pack-alert-setup">
    <OCheckbox
      v-model="turnOn"
      size="md"
      :aria-label="t('starterPacks.alertStep.turnOn', { count }, count)"
      data-test="starter-pack-alert-setup-turn-on-check"
    >
      <template #label>
        <span class="text-text-body" data-test="starter-pack-alert-setup-turn-on-label">{{
          t("starterPacks.alertStep.turnOn", { count }, count)
        }}</span>
      </template>
    </OCheckbox>

    <div class="flex flex-col gap-1.5">
      <div class="flex min-h-8 items-center gap-3" data-test="starter-pack-alert-setup-send-to-row">
        <OCheckbox
          v-model="sendTo"
          size="md"
          :disabled="mode === 'none'"
          :aria-label="t('starterPacks.alertStep.sendTo')"
          data-test="starter-pack-alert-setup-send-to"
        >
          <template #label>
            <span
              v-if="mode === 'email'"
              :class="['block min-w-0 truncate', sendTo ? 'text-text-body' : 'text-text-muted']"
              data-test="starter-pack-alert-setup-send-to-label"
            >
              <i18n-t
                keypath="starterPacks.alertStep.sendToEmail"
                tag="span"
                data-test="starter-pack-alert-setup-email-me"
              >
                <template #icon>
                  <OIcon
                    name="mail"
                    size="sm"
                    class="inline-block align-text-bottom"
                    data-test="starter-pack-alert-setup-email-icon"
                  />
                </template>
                <template #email>{{ email }}</template>
              </i18n-t>
            </span>
            <span
              v-else
              :class="['shrink-0', mode === 'none' ? 'text-text-muted' : 'text-text-body']"
              data-test="starter-pack-alert-setup-send-to-label"
              >{{ t("starterPacks.alertStep.sendTo") }}</span
            >
          </template>
        </OCheckbox>
        <OSkeleton
          v-if="mode === 'loading'"
          type="rect"
          class="rounded-default h-8 flex-1"
          data-test="starter-pack-alert-setup-dest-loading"
        />
        <div v-else-if="mode === 'select'" class="min-w-0 flex-1">
          <OSelect
            :model-value="destination"
            :options="options"
            searchable
            size="sm"
            :disabled="!sendTo"
            :aria-label="t('starterPacks.alertStep.sendTo')"
            data-test="starter-pack-alert-setup-dest-select"
            @update:model-value="pickDestination"
          >
            <template #icon-left>
              <OIcon name="search" size="sm" />
            </template>
          </OSelect>
        </div>
      </div>
      <OText
        v-if="mode === 'select' && isFirst"
        variant="meta"
        class="ps-7"
        data-test="starter-pack-alert-setup-first-of"
        >{{
          t(
            "starterPacks.alertStep.firstOf",
            { count: destinations?.length ?? 0 },
            destinations?.length ?? 0,
          )
        }}</OText
      >
      <OText
        v-else-if="mode === 'email' && sendTo"
        variant="meta"
        class="ps-7"
        data-test="starter-pack-alert-setup-email-note"
        >{{ t("starterPacks.alertStep.emailCreateNote") }}</OText
      >
      <span
        v-else-if="mode === 'none'"
        class="text-text-secondary flex items-start gap-2 ps-7 text-xs"
        data-test="starter-pack-alert-setup-no-destination"
      >
        <OIcon name="info" size="sm" class="mt-px shrink-0" />
        <span>{{ t("starterPacks.alertStep.noDestination") }}</span>
      </span>
    </div>

    <span
      v-if="historyOnly"
      class="text-text-secondary flex items-start gap-2 text-xs"
      data-test="starter-pack-alert-setup-history-only"
    >
      <OIcon name="info" size="sm" class="mt-px shrink-0" />
      <span>{{ t("starterPacks.alertStep.historyOnly") }}</span>
    </span>
  </div>
</template>
