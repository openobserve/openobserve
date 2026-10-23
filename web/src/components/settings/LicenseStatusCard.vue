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
  <OCard class="border-card-glass-border mb-4 border border-solid" data-test="license-status-card">
    <OCardSection role="body">
      <div class="mb-3 text-xl font-semibold">{{ t("about.license_status_title") }}</div>
      <OBanner
        v-if="envKeyActive && revHwmWarning?.source !== 'env'"
        :variant="envKeyInUse ? 'warning' : 'info'"
        :icon="envKeyInUse ? 'warning' : 'info'"
        class="mb-3"
        :content="
          envKeyInUse
            ? t('about.license_status_env_key')
            : t('about.license_status_env_key_superseded')
        "
        data-test="license-status-env-key"
      />
      <OBanner
        v-if="revHwmWarning"
        variant="warning"
        icon="warning"
        class="mb-3"
        inline-actions
        :content="revWarningText"
        data-test="license-status-rev-hwm"
      >
        <template #actions>
          <OButton
            v-if="revHwmWarning.source === 'db' && canUpdateLicense"
            variant="outline"
            size="sm-action"
            data-test="license-status-rev-hwm-add-key"
            @click="emit('add-license-key')"
            >{{ t("about.add_new_license_key") }}</OButton
          >
        </template>
      </OBanner>
      <ODescriptionList>
        <ODescriptionItem :label="t('about.license_status_search')">
          <div data-test="license-status-search">
            <OBadge :variant="decision.search_allowed ? 'success' : 'error'">
              {{
                decision.search_allowed
                  ? t("about.license_status_on")
                  : t("about.license_status_paused")
              }}
            </OBadge>
            <div v-if="restoredByWaiver && base" class="mt-2 text-sm">
              {{
                t("about.license_status_on_by_waiver", {
                  exceeded: base.exceeded_days,
                  allowed: base.allowed_days,
                })
              }}
            </div>
            <ul v-if="reasons.length" class="mt-2 list-disc ps-5 text-sm">
              <li v-for="reason in reasons" :key="reason.key" data-test="license-status-reason">
                {{ reason.text }}
              </li>
            </ul>
          </div>
        </ODescriptionItem>
        <ODescriptionItem :label="t('about.license_status_limit_today')">
          <span data-test="license-status-limit">{{ limitText }}</span>
        </ODescriptionItem>
        <ODescriptionItem
          v-if="evaluated && decision.limit_today_gb != null"
          :label="t('about.license_status_allowed_days')"
          data-test="license-status-days"
        >
          {{ daysText }}
        </ODescriptionItem>
      </ODescriptionList>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import {
  issuedOn,
  quotaPercent,
  type LicenseDecision,
  type RevHwmWarning,
} from "@/utils/licenseWaivers";

const props = defineProps<{
  decision: LicenseDecision;
  base?: LicenseDecision;
  envKeyActive: boolean;
  envKeyInUse?: boolean;
  evaluatedAt?: number;
  revHwmWarning?: RevHwmWarning | null;
  canUpdateLicense?: boolean;
}>();

const emit = defineEmits<{ "add-license-key": [] }>();
const { t, locale } = useI18nTyped();

const revWarningText = computed(() => {
  const warning = props.revHwmWarning;
  if (!warning) return undefined;
  const undated = warning.loaded_rev === 0;
  const key =
    warning.source === "env"
      ? undated
        ? "about.license_status_env_below_hwm_undated"
        : "about.license_status_env_below_hwm"
      : undated
        ? "about.license_status_db_below_hwm_undated"
        : "about.license_status_db_below_hwm";
  return t(key, {
    loaded: issuedOn(warning.loaded_rev, locale.value),
    hwm: issuedOn(warning.hwm_rev, locale.value),
    variable: raw("O2_LICENSE_KEY"),
  });
});

const envKeyInUse = computed(() => props.envKeyInUse !== false);

const evaluated = computed(() => props.evaluatedAt !== 0);

const restoredByWaiver = computed(
  () => props.decision.search_allowed && !!props.base && !props.base.search_allowed,
);

const reasons = computed<{ key: string; text: string }[]>(() => {
  if (props.decision.search_allowed) return [];
  const d = props.decision;
  return d.blocks.flatMap((block): { key: string; text: string }[] => {
    switch (block) {
      case "usage_over_limit":
        return [
          {
            key: block,
            text: t("about.license_status_reason_usage", {
              exceeded: d.exceeded_days,
              allowed: d.allowed_days,
            }),
          },
        ];
      case "report_failure":
        return [{ key: block, text: t("about.license_status_reason_report") }];
      case "lv_verdict":
        return [{ key: block, text: t("about.license_status_reason_validator") }];
      default:
        return [];
    }
  });
});

const daysText = computed(() => {
  const d = props.decision;
  const params = { allowed: d.allowed_days, used: d.exceeded_days };
  if (props.base && props.base.exceeded_days !== d.exceeded_days) {
    return t("about.license_status_allowed_days_value_base", {
      ...params,
      base: props.base.exceeded_days,
    });
  }
  return t("about.license_status_allowed_days_value", params);
});

const limitText = computed(() => {
  const d = props.decision;
  if (!evaluated.value) return "—";
  if (d.limit_today_gb == null) return t("about.license_status_unlimited");
  const percent = quotaPercent(d) ?? 0;
  return t("about.license_status_limit_value", { limit: d.limit_today_gb, percent });
});
</script>
