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
        v-if="envKeyActive"
        variant="warning"
        icon="info"
        class="mb-3"
        :content="t('about.license_status_env_key')"
        data-test="license-status-env-key"
      />
      <table class="border-table-header-border w-full border-collapse border border-solid">
        <tbody>
          <tr class="border-table-row-divider border-b border-solid">
            <td
              class="border-table-row-divider border-e border-solid px-3 py-2 leading-[1.2] font-bold"
            >
              {{ t("about.license_status_search") }}
            </td>
            <td class="px-3 py-2 leading-[1.2]" data-test="license-status-search">
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
            </td>
          </tr>
          <tr class="border-table-row-divider border-b border-solid">
            <td
              class="border-table-row-divider border-e border-solid px-3 py-2 leading-[1.2] font-bold"
            >
              {{ t("about.license_status_limit_today") }}
            </td>
            <td class="px-3 py-2 leading-[1.2]" data-test="license-status-limit">
              {{ limitText }}
            </td>
          </tr>
          <tr v-if="decision.limit_today_gb != null" data-test="license-status-days">
            <td
              class="border-table-row-divider border-e border-solid px-3 py-2 leading-[1.2] font-bold"
            >
              {{ t("about.license_status_allowed_days") }}
            </td>
            <td class="px-3 py-2 leading-[1.2]">
              {{
                t("about.license_status_allowed_days_value", {
                  allowed: decision.allowed_days,
                  used: decision.exceeded_days,
                })
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { quotaPercent, type LicenseDecision } from "@/utils/licenseWaivers";

const props = defineProps<{
  decision: LicenseDecision;
  base?: LicenseDecision;
  envKeyActive: boolean;
}>();

const { t } = useI18nTyped();

const restoredByWaiver = computed(
  () => props.decision.search_allowed && !!props.base && !props.base.search_allowed,
);

const reasons = computed(() => {
  if (props.decision.search_allowed) return [];
  const d = props.decision;
  return d.blocks.flatMap((block) => {
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

const limitText = computed(() => {
  const d = props.decision;
  const percent = quotaPercent(d);
  if (d.limit_today_gb == null || percent == null) return t("about.license_status_unlimited");
  return t("about.license_status_limit_value", { limit: d.limit_today_gb, percent });
});
</script>
