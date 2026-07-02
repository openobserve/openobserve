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
  <div class="org-storage-settings ">
      <template v-if="currentAction === 'list'">
          <AppPageHeader
            :title="t('storage_settings.title')"
            icon="cloud"
            :subtitle="'Per-organization storage configuration'"
            class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
          />

    <!-- Loading state -->
    <div v-if="loading" class="tw:flex tw:justify-center tw:items-center" style="min-height: calc(100vh - var(--navbar-height) - 120px)">
      <OSpinner size="md" data-test="org-storage-settings-loading-indicator" />
    </div>

    <!-- Cloud: storage not enabled -->
    <div
      v-else-if="isCloud && !orgStorageEnabled"
      class="tw:text-sm tw:text-gray-500 tw:py-3"
    >
      {{ t('storage_settings.notEnabled') }}
    </div>

    <!-- ========== NOT CONFIGURED: cloud hero ========== -->
    <div
      v-else-if="!isConfigured && isCloud"
      class="hero-page tw:flex tw:flex-col"
      :style="{ minHeight: 'calc(100vh - var(--navbar-height) - 100px)' }"
      :class="store.state.theme === 'dark' ? 'hero-page--dark' : ''"
    >
      <div class="hero-page__body tw:flex tw:items-center tw:justify-between tw:flex-1 tw:py-[72px] tw:px-[80px]" style="gap: 56px;">
        <!-- left -->
        <div class="hero-page__left tw:flex-1 tw:max-w-[480px]">

          <div class="hero-page__headline tw:font-bold tw:leading-tight tw:mb-[18px] tw:text-[#111827]" :class="store.state.theme === 'dark' ? 'tw:text-[#f1f1f5]' : ''" style="font-size: 2.6rem; letter-spacing: -0.6px; line-height: 1.2;">
            {{ t("storage_settings.heroHeadline") }} <span class="hero-page__brand-text tw:text-(--q-primary)">OpenObserve.</span>
          </div>

          <div class="hero-page__sub tw:leading-[1.7] tw:text-[#6b7280] tw:mb-9 tw:max-w-[400px]" :class="store.state.theme === 'dark' ? 'tw:text-[#9ca3af]' : ''" style="font-size: 0.97rem;">
            {{ t("storage_settings.heroSub") }}
          </div>

          <div class="hero-page__actions tw:mb-7">
            <OButton
              data-test="storage-settings-configure-btn"
              variant="primary"
              class="no-border o2-primary-button hero-cta-btn tw:h-11 tw:px-7 tw:font-semibold" style="font-size: 0.95rem;"
              :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
              @click="navigateToCreate"
            >
              {{ t("storage_settings.configureStorage") }}
            </OButton>
          </div>

          <!-- supported infrastructure -->
          <div class="hero-page__inline-providers tw:flex tw:items-center tw:gap-3">
            <span class="hero-page__inline-label tw:font-medium tw:whitespace-nowrap tw:text-[#aaa]" :class="store.state.theme === 'dark' ? 'tw:text-[#666]' : ''" style="font-size: 0.8rem; letter-spacing: 0px;">{{ t("storage_settings.supportedProviders") }}</span>
            <div class="hero-page__inline-logos tw:flex tw:items-center" style="gap: 10px;">
              <div
                v-for="p in availableProviders"
                :key="p.value"
                class="hero-page__inline-logo-wrap tw:w-7 tw:h-7 tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:cursor-default tw:opacity-70 tw:transition-opacity tw:duration-150"
              >
                <img :src="p.image" :alt="p.label" class="hero-page__inline-logo tw:w-7 tw:h-7 tw:max-w-[28px] tw:max-h-[28px] tw:object-contain tw:block" />
                <OTooltip :content="p.label" />
              </div>
            </div>
          </div>
        </div>

        <!-- right: feature cards -->
        <div class="hero-page__right tw:w-[340px] tw:shrink-0 tw:flex tw:flex-col" style="gap: 14px;">
          <div
            v-for="feature in features"
            :key="feature.title"
            class="feature-card tw:flex tw:items-start tw:rounded-[16px] tw:border tw:border-[rgba(0,0,0,0.07)] tw:bg-white tw:transition-all tw:duration-200" style="gap: 16px; padding: 20px 22px; box-shadow: 0 2px 12px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.04);"
            :class="store.state.theme === 'dark' ? 'feature-card--dark tw:bg-[rgba(255,255,255,0.05)] tw:border-[rgba(255,255,255,0.08)] tw:[box-shadow:0_2px_12px_rgba(0,0,0,0.3)]' : ''"
          >
            <div class="feature-card__icon-box tw:w-10 tw:h-10 tw:rounded-[10px] tw:bg-[rgba(66,133,244,0.08)] tw:flex tw:items-center tw:justify-center tw:shrink-0" :class="store.state.theme === 'dark' ? 'feature-card__icon-box--dark tw:bg-[rgba(66,133,244,0.15)]' : ''">
              <OIcon :name="feature.icon" size="md" class="feature-card__icon tw:text-(--q-primary) tw:opacity-85" />
            </div>
            <div class="feature-card__content tw:pt-[2px] tw:flex-1">
              <div class="feature-card__title tw:font-bold tw:text-[#111827] tw:mb-[5px]" :class="store.state.theme === 'dark' ? 'tw:text-[#f3f4f6]' : ''" style="font-size: 0.92rem;">{{ feature.title }}</div>
              <div class="feature-card__desc tw:text-[#6b7280] tw:leading-[1.55]" :class="store.state.theme === 'dark' ? 'tw:text-[#9ca3af]' : ''" style="font-size: 0.8rem;">{{ feature.desc }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== NOT CONFIGURED: enterprise empty state ========== -->
    <div
      v-else-if="!isConfigured && !isCloud"
      class="ent-empty tw:flex tw:flex-col tw:items-center tw:justify-center tw:text-center tw:py-12 tw:px-6"
      :style="{ minHeight: 'calc(100vh - var(--navbar-height) - 160px)' }"
      :class="store.state.theme === 'dark' ? 'ent-empty--dark' : ''"
    >
      <!-- double-ring icon -->
      <div class="ent-empty__icon-outer tw:w-[100px] tw:h-[100px] tw:rounded-full tw:border tw:border-dashed tw:border-[rgba(66,133,244,0.25)] tw:flex tw:items-center tw:justify-center tw:mb-7" :class="store.state.theme === 'dark' ? 'tw:border-[rgba(66,133,244,0.3)]' : ''">
        <div class="ent-empty__icon-inner tw:w-[68px] tw:h-[68px] tw:rounded-full tw:bg-[rgba(66,133,244,0.09)] tw:flex tw:items-center tw:justify-center" style="border: 1.5px solid rgba(66,133,244,0.22);" :class="store.state.theme === 'dark' ? 'ent-empty__icon-inner--dark tw:bg-[rgba(66,133,244,0.18)] tw:border-[rgba(66,133,244,0.35)]' : ''">
          <OIcon name="cloud-upload" size="lg" class="ent-empty__icon tw:text-(--q-primary) tw:opacity-85" />
        </div>
      </div>

      <div class="ent-empty__title tw:font-bold tw:text-[#111827] tw:mb-[10px]" :class="store.state.theme === 'dark' ? 'tw:text-[#f1f1f5]' : ''" style="font-size: 1.2rem; letter-spacing: -0.2px;">{{ t("storage_settings.noStorageConfigured") }}</div>

      <div class="ent-empty__desc tw:text-[#6b7280] tw:leading-[1.65] tw:max-w-[400px] tw:mb-6" :class="store.state.theme === 'dark' ? 'tw:text-[#9ca3af]' : ''" style="font-size: 0.88rem;">
        {{ t("storage_settings.routeDataDesc") }}
      </div>

      <!-- key fact chips -->
      <div class="ent-empty__chips tw:flex tw:items-center tw:gap-2 tw:flex-wrap tw:justify-center tw:mb-8">
        <span class="ent-empty__chip tw:inline-flex tw:items-center tw:font-medium tw:text-[#6b7280] tw:bg-[#f3f4f6] tw:border tw:border-[#e5e7eb] tw:rounded-[20px] tw:py-1 tw:px-3" style="gap: 5px; font-size: 0.75rem;" :class="store.state.theme === 'dark' ? 'ent-empty__chip--dark tw:text-[#9ca3af] tw:bg-[rgba(255,255,255,0.06)] tw:border-[rgba(255,255,255,0.1)]' : ''">
          <OIcon name="corporate-fare" size="xs" />
          {{ t("storage_settings.perOrgIsolation") }}
        </span>
        <span class="ent-empty__chip tw:inline-flex tw:items-center tw:font-medium tw:text-[#6b7280] tw:bg-[#f3f4f6] tw:border tw:border-[#e5e7eb] tw:rounded-[20px] tw:py-1 tw:px-3" style="gap: 5px; font-size: 0.75rem;" :class="store.state.theme === 'dark' ? 'ent-empty__chip--dark tw:text-[#9ca3af] tw:bg-[rgba(255,255,255,0.06)] tw:border-[rgba(255,255,255,0.1)]' : ''">
          <OIcon name="bolt" size="xs" />
          {{ t("storage_settings.appliesImmediately") }}
        </span>
        <span class="ent-empty__chip tw:inline-flex tw:items-center tw:font-medium tw:text-[#6b7280] tw:bg-[#f3f4f6] tw:border tw:border-[#e5e7eb] tw:rounded-[20px] tw:py-1 tw:px-3" style="gap: 5px; font-size: 0.75rem;" :class="store.state.theme === 'dark' ? 'ent-empty__chip--dark tw:text-[#9ca3af] tw:bg-[rgba(255,255,255,0.06)] tw:border-[rgba(255,255,255,0.1)]' : ''">
          <OIcon name="lock" size="xs" />
          {{ t("storage_settings.usesOrgCredentials") }}
        </span>
      </div>

      <OButton
        data-test="storage-settings-configure-btn"
        variant="primary"
        class="no-border o2-primary-button ent-empty__btn tw:h-10 tw:font-semibold tw:mb-9 tw:px-6" style="font-size: 0.92rem;"
        :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
        @click="navigateToCreate"
      >
        {{ t("storage_settings.configureStorage") }}
      </OButton>

      <div class="ent-empty__providers tw:flex tw:items-center tw:gap-3">
        <span class="ent-empty__providers-label tw:font-medium tw:whitespace-nowrap tw:text-[#aaa]" :class="store.state.theme === 'dark' ? 'tw:text-[#666]' : ''" style="font-size: 0.78rem;">{{ t("storage_settings.supportedProviders") }}</span>
        <div class="ent-empty__providers-logos tw:flex tw:items-center" style="gap: 10px;">
          <div
            v-for="p in providerDefinitions"
            :key="p.value"
            class="ent-empty__logo-wrap tw:w-7 tw:h-7 tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:cursor-default tw:opacity-[0.65] tw:transition-opacity tw:duration-150"
          >
            <img :src="p.image" :alt="p.label" class="ent-empty__logo tw:w-7 tw:h-7 tw:max-w-[28px] tw:max-h-[28px] tw:object-contain tw:block" />
            <OTooltip :content="p.label" />
          </div>
        </div>
      </div>
    </div>

    <!-- ========== CONFIGURED ========== -->
    <div v-else>

      <div class="tw:p-3">
      <OCard
        class="storage-card tw:rounded-xl"
        :class="store.state.theme === 'dark' ? 'storage-card--dark tw:bg-[#1e1e1e]' : ''"
        style="max-width: 680px;"
      >
        <!-- Card header: logo + name + badge | update button -->
        <OCardSection role="header">
          <div class="tw:flex tw:items-center tw:flex-nowrap tw:flex-1" style="gap: 14px;">
            <img
              :src="configuredProviderImage"
              :alt="configuredProviderLabel"
              style="width: 44px; height: 44px; object-fit: contain; flex-shrink: 0;"
            />
            <div>
              <div class="tw:text-base tw:font-medium" style="font-weight: 700; line-height: 1.3;">
                {{ configuredProviderLabel }}
              </div>
              <OBadge
                variant="success"
                style="font-size: 11px; padding: 2px 8px; margin-top: 4px;"
              >
                <OIcon name="check-circle" size="xs" style="margin-right: 3px;" />
                {{ t("storage_settings.active") }}
              </OBadge>
            </div>
          </div>
          <OButton
            data-test="storage-settings-update-btn"
            variant="primary"
            size="sm"
            class="no-border o2-primary-button"
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            @click="navigateToEdit"
          >
            {{ t("storage_settings.updateStorage") }}
          </OButton>
        </OCardSection>

        <OSeparator />

        <!-- Field grid -->
        <OCardSection role="body">
          <div class="storage-detail-grid tw:grid tw:gap-x-8 tw:gap-y-5" style="grid-template-columns: repeat(2, 1fr);">
            <div v-if="storageData.bucket_name" class="storage-field">
              <div class="storage-field__label tw:text-xs tw:text-[#6b7280] tw:capitalize tw:mb-[3px] tw:font-medium">{{ t("storage_settings.bucketName") }}</div>
              <div class="storage-field__value tw:text-[#6b7280] tw:break-all" style="font-size: 0.9rem; color: var(--o2-text-primary);">{{ storageData.bucket_name }}</div>
            </div>
            <div v-if="storageData.region" class="storage-field">
              <div class="storage-field__label tw:text-xs tw:text-[#6b7280] tw:capitalize tw:mb-[3px] tw:font-medium">{{ t("storage_settings.region") }}</div>
              <div class="storage-field__value tw:break-all" style="font-size: 0.9rem; color: var(--o2-text-primary);">{{ storageData.region }}</div>
            </div>
            <div v-if="storageData.server_url && !isCloud" class="storage-field">
              <div class="storage-field__label tw:text-xs tw:text-[#6b7280] tw:capitalize tw:mb-[3px] tw:font-medium">{{ t("storage_settings.serverUrl") }}</div>
              <div class="storage-field__value tw:break-all" style="font-size: 0.9rem; color: var(--o2-text-primary);">{{ storageData.server_url }}</div>
            </div>
            <div v-if="storageData.access_key" class="storage-field">
              <div class="storage-field__label tw:text-xs tw:text-[#6b7280] tw:capitalize tw:mb-[3px] tw:font-medium">{{ t("storage_settings.accessKey") }}</div>
              <div class="storage-field__value tw:break-all" style="font-size: 0.9rem; color: var(--o2-text-primary);">{{ storageData.access_key }}</div>
            </div>
            <div v-if="storageData.secret_key" class="storage-field">
              <div class="storage-field__label tw:text-xs tw:text-[#6b7280] tw:capitalize tw:mb-[3px] tw:font-medium">{{ t("storage_settings.secretKey") }}</div>
              <div class="storage-field__value tw:break-all" style="font-size: 0.9rem; color: var(--o2-text-primary);">{{ storageData.secret_key }}</div>
            </div>
            <div v-if="storageData.role_arn" class="storage-field">
              <div class="storage-field__label tw:text-xs tw:text-[#6b7280] tw:capitalize tw:mb-[3px] tw:font-medium">{{ t("storage_settings.roleArn") }}</div>
              <div class="storage-field__value tw:break-all" style="font-size: 0.9rem; color: var(--o2-text-primary); word-break: break-all;">{{ storageData.role_arn }}</div>
            </div>
          </div>
        </OCardSection>

        <OSeparator v-if="configTimestamps" />

        <!-- Timestamps -->
        <OCardSection v-if="configTimestamps">
          <div class="tw:flex" style="gap: 40px;">
            <div v-if="configTimestamps.created_at" class="tw:flex tw:items-center" style="gap: 6px;">
              <span class="storage-field__label tw:text-xs tw:text-[#6b7280] tw:capitalize tw:font-medium" style="margin-bottom: 0;">{{ t("storage_settings.createdAt") }}</span>
              <span class="tw:text-sm">{{ configTimestamps.created_at }}</span>
            </div>
            <div v-if="configTimestamps.updated_at" class="tw:flex tw:items-center" style="gap: 6px;">
              <span class="storage-field__label tw:text-xs tw:text-[#6b7280] tw:capitalize tw:font-medium" style="margin-bottom: 0;">{{ t("storage_settings.updatedAt") }}</span>
              <span class="tw:text-sm">{{ configTimestamps.updated_at }}</span>
            </div>
          </div>
        </OCardSection>
      </OCard>
      </div>
    </div>
    </template>
    <OrgStorageEditor
      v-else
      :action="currentAction"
      @cancel="currentAction = 'list'"
      @saved="onEditorSaved"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from "vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import config from "@/aws-exports";
import orgStorageService from "@/services/org_storage";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OrgStorageEditor from "./OrgStorageEditor.vue";

const store = useStore();
const { t } = useI18n();

const features = [
  {
    icon: "dataset",
    title: t("storage_settings.featureOwnDataTitle"),
    desc: t("storage_settings.featureOwnDataDesc"),
  },
  {
    icon: "security",
    title: t("storage_settings.featureSecureTitle"),
    desc: t("storage_settings.featureSecureDesc"),
  },
];

const loading = ref(true);
const existingConfig = ref<any>(null);
const currentAction = ref<"list" | "add" | "edit">("list");


const isCloud = computed(() => config.isCloud === "true");

const orgStorageEnabled = computed(() => {
  return (
    !isCloud.value ||
    (store.state as any).zoConfig?.org_storage_enabled !== false
  );
});

const isConfigured = computed(() => existingConfig.value?.provider != null);

// data is already a parsed object from the API
const storageData = computed(() => existingConfig.value?.data || {});

const configuredProviderLabel = computed(() => {
  const found = providerDefinitions.find(
    (p) => p.value === existingConfig.value?.provider
  );
  return found?.label || existingConfig.value?.provider || "";
});

const configuredProviderImage = computed(() => {
  const found = providerDefinitions.find(
    (p) => p.value === existingConfig.value?.provider
  );
  return found?.image || "";
});

const configTimestamps = computed(() => {
  const cfg = existingConfig.value;
  if (!cfg) return null;
  const format = (micros: number) => {
    if (!micros || micros <= 0) return null;
    return new Date(micros / 1000).toLocaleString();
  };
  return {
    created_at: format(cfg.created_at),
    updated_at: format(cfg.updated_at),
  };
});


const providerDefinitions = [
  {
    label: "AWS Credentials",
    value: "AwsCredentials",
    image: getImageURL("images/org_storage/aws_plain_without_bg.png"),
  },
  {
    label: "Azure Credentials",
    value: "AzureCredentials",
    image: getImageURL("images/org_storage/azure.png"),
  },
  // {
  //   label: "GCP Credentials",
  //   value: "GcpCredentials",
  //   image: getImageURL("images/org_storage/gcp.png"),
  // },
  {
    label: "AWS Role ARN",
    value: "AwsRoleArn",
    image: getImageURL("images/org_storage/aws_iam.png"),
  },
];


const cloudProviders = computed(() => {
  const raw = (store.state as any).zoConfig?.org_storage_providers;
  if (!raw || !isCloud.value) return null;
  return raw.split(",").map((s: string) => s.trim());
});

const availableProviders = computed(() => {
  let providers = [...providerDefinitions];
  if (isCloud.value && cloudProviders.value) {
    providers = providers.filter((p) =>
      cloudProviders.value!.includes(p.value)
    );
  }
  return providers;
});
async function fetchExistingConfig() {
  loading.value = true;
  try {
    const orgId = store.state.selectedOrganization.identifier;
    const res = await orgStorageService.get(orgId);
    existingConfig.value = res.data;
  } catch {
    // 404 or other errors — treat as not configured
  } finally {
    loading.value = false;
  }
}

function navigateToCreate() {
  currentAction.value = "add";
}

function navigateToEdit() {
  currentAction.value = "edit";
}

async function onEditorSaved() {
  currentAction.value = "list";
  await fetchExistingConfig();
}

onMounted(() => {
  fetchExistingConfig();
});
</script>

<style>
.hero-page__inline-logo-wrap:hover {
  opacity: 1;
}

.feature-card:hover {
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.ent-empty__logo-wrap:hover {
  opacity: 1;
}
</style>
