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
            :subtitle="t('settings.orgStorageSettings.subtitle')"
            class="shrink-0 px-4 border-b border-border-default"
          />

    <!-- Loading state -->
    <div v-if="loading" class="flex justify-center items-center" style="min-height: calc(100vh - var(--navbar-height) - 120px)">
      <OSpinner size="md" data-test="org-storage-settings-loading-indicator" />
    </div>

    <!-- Cloud: storage not enabled -->
    <div
      v-else-if="isCloud && !orgStorageEnabled"
      class="text-sm text-gray-500 py-3"
    >
      {{ t('storage_settings.notEnabled') }}
    </div>

    <!-- ========== NOT CONFIGURED: cloud hero ========== -->
    <div
      v-else-if="!isConfigured && isCloud"
      class="hero-page flex flex-col"
      :style="{ minHeight: 'calc(100vh - var(--navbar-height) - 100px)' }"
      :class="store.state.theme === 'dark' ? 'hero-page--dark' : ''"
    >
      <div class="hero-page__body flex items-center justify-between flex-1 py-[72px] px-[80px]" style="gap: 56px;">
        <!-- left -->
        <div class="hero-page__left flex-1 max-w-[480px]">

          <div class="hero-page__headline font-bold leading-tight mb-[18px] text-[#111827]" :class="store.state.theme === 'dark' ? 'text-[#f1f1f5]' : ''" style="font-size: 2.6rem; letter-spacing: -0.6px; line-height: 1.2;">
            {{ t("storage_settings.heroHeadline") }} <span class="hero-page__brand-text text-(--q-primary)">OpenObserve.</span>
          </div>

          <div class="hero-page__sub leading-[1.7] text-[#6b7280] mb-9 max-w-[400px]" :class="store.state.theme === 'dark' ? 'text-[#9ca3af]' : ''" style="font-size: 0.97rem;">
            {{ t("storage_settings.heroSub") }}
          </div>

          <div class="hero-page__actions mb-7">
            <OButton
              data-test="storage-settings-configure-btn"
              variant="primary"
              class="no-border o2-primary-button hero-cta-btn h-11 px-7 font-semibold" style="font-size: 0.95rem;"
              :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
              @click="navigateToCreate"
            >
              {{ t("storage_settings.configureStorage") }}
            </OButton>
          </div>

          <!-- supported infrastructure -->
          <div class="hero-page__inline-providers flex items-center gap-3">
            <span class="hero-page__inline-label font-medium whitespace-nowrap text-[#aaa]" :class="store.state.theme === 'dark' ? 'text-[#666]' : ''" style="font-size: 0.8rem; letter-spacing: 0px;">{{ t("storage_settings.supportedProviders") }}</span>
            <div class="hero-page__inline-logos flex items-center" style="gap: 10px;">
              <div
                v-for="p in availableProviders"
                :key="p.value"
                class="hero-page__inline-logo-wrap w-7 h-7 flex items-center justify-center shrink-0 cursor-default opacity-70 transition-opacity duration-150"
              >
                <img :src="p.image" :alt="p.label" class="hero-page__inline-logo w-7 h-7 max-w-[28px] max-h-[28px] object-contain block" />
                <OTooltip :content="p.label" />
              </div>
            </div>
          </div>
        </div>

        <!-- right: feature cards -->
        <div class="hero-page__right w-[340px] shrink-0 flex flex-col" style="gap: 14px;">
          <div
            v-for="feature in features"
            :key="feature.title"
            class="feature-card flex items-start rounded-[16px] border border-[rgba(0,0,0,0.07)] bg-white transition-all duration-200" style="gap: 16px; padding: 20px 22px; box-shadow: 0 2px 12px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.04);"
            :class="store.state.theme === 'dark' ? 'feature-card--dark bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] [box-shadow:0_2px_12px_rgba(0,0,0,0.3)]' : ''"
          >
            <div class="feature-card__icon-box w-10 h-10 rounded-[10px] bg-[rgba(66,133,244,0.08)] flex items-center justify-center shrink-0" :class="store.state.theme === 'dark' ? 'feature-card__icon-box--dark bg-[rgba(66,133,244,0.15)]' : ''">
              <OIcon :name="feature.icon" size="md" class="feature-card__icon text-(--q-primary) opacity-85" />
            </div>
            <div class="feature-card__content pt-[2px] flex-1">
              <div class="feature-card__title font-bold text-[#111827] mb-[5px]" :class="store.state.theme === 'dark' ? 'text-[#f3f4f6]' : ''" style="font-size: 0.92rem;">{{ feature.title }}</div>
              <div class="feature-card__desc text-[#6b7280] leading-[1.55]" :class="store.state.theme === 'dark' ? 'text-[#9ca3af]' : ''" style="font-size: 0.8rem;">{{ feature.desc }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== NOT CONFIGURED: enterprise empty state ========== -->
    <div
      v-else-if="!isConfigured && !isCloud"
      class="w-full"
      :style="{ minHeight: 'calc(100vh - var(--navbar-height) - 160px)' }"
    >
      <OEmptyState
        size="hero"
        preset="no-storage-config"
        data-test="org-storage-settings-empty-state"
        @action="(id) => id === 'configure' && navigateToCreate()"
      >
        <template #extra>
          <!-- key fact chips -->
          <div class="flex items-center gap-2 flex-wrap justify-center">
            <span class="inline-flex items-center gap-1.5 font-medium text-xs text-text-secondary bg-surface-subtle border border-border-default rounded-full py-1 px-3">
              <OIcon name="corporate-fare" size="xs" />
              {{ t("storage_settings.perOrgIsolation") }}
            </span>
            <span class="inline-flex items-center gap-1.5 font-medium text-xs text-text-secondary bg-surface-subtle border border-border-default rounded-full py-1 px-3">
              <OIcon name="bolt" size="xs" />
              {{ t("storage_settings.appliesImmediately") }}
            </span>
            <span class="inline-flex items-center gap-1.5 font-medium text-xs text-text-secondary bg-surface-subtle border border-border-default rounded-full py-1 px-3">
              <OIcon name="lock" size="xs" />
              {{ t("storage_settings.usesOrgCredentials") }}
            </span>
          </div>

          <!-- supported providers -->
          <div class="flex items-center gap-3">
            <span class="font-medium whitespace-nowrap text-xs text-text-disabled">{{ t("storage_settings.supportedProviders") }}</span>
            <div class="flex items-center gap-2.5">
              <div
                v-for="p in providerDefinitions"
                :key="p.value"
                class="w-7 h-7 flex items-center justify-center shrink-0 cursor-default opacity-65 hover:opacity-100 transition-opacity duration-150"
              >
                <img :src="p.image" :alt="p.label" class="w-7 h-7 max-w-7 max-h-7 object-contain block" />
                <OTooltip :content="p.label" />
              </div>
            </div>
          </div>
        </template>
      </OEmptyState>
    </div>

    <!-- ========== CONFIGURED ========== -->
    <div v-else>

      <div class="p-3">
      <OCard
        class="storage-card rounded-xl"
        :class="store.state.theme === 'dark' ? 'storage-card--dark bg-[#1e1e1e]' : ''"
        style="max-width: 680px;"
      >
        <!-- Card header: logo + name + badge | update button -->
        <OCardSection role="header">
          <div class="flex items-center flex-nowrap flex-1" style="gap: 14px;">
            <img
              :src="configuredProviderImage"
              :alt="configuredProviderLabel"
              style="width: 44px; height: 44px; object-fit: contain; flex-shrink: 0;"
            />
            <div>
              <div class="text-base font-medium" style="font-weight: 700; line-height: 1.3;">
                {{ configuredProviderLabel }}
              </div>
              <OTag type="activeFlag" class="mt-1" />
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
          <div class="storage-detail-grid grid gap-x-8 gap-y-5" style="grid-template-columns: repeat(2, 1fr);">
            <div v-if="storageData.bucket_name" class="storage-field">
              <div class="storage-field__label text-xs text-[#6b7280] capitalize mb-[3px] font-medium">{{ t("storage_settings.bucketName") }}</div>
              <div class="storage-field__value text-[#6b7280] break-all" style="font-size: 0.9rem; color: var(--o2-text-primary);">{{ storageData.bucket_name }}</div>
            </div>
            <div v-if="storageData.region" class="storage-field">
              <div class="storage-field__label text-xs text-[#6b7280] capitalize mb-[3px] font-medium">{{ t("storage_settings.region") }}</div>
              <div class="storage-field__value break-all" style="font-size: 0.9rem; color: var(--o2-text-primary);">{{ storageData.region }}</div>
            </div>
            <div v-if="storageData.server_url && !isCloud" class="storage-field">
              <div class="storage-field__label text-xs text-[#6b7280] capitalize mb-[3px] font-medium">{{ t("storage_settings.serverUrl") }}</div>
              <div class="storage-field__value break-all" style="font-size: 0.9rem; color: var(--o2-text-primary);">{{ storageData.server_url }}</div>
            </div>
            <div v-if="storageData.access_key" class="storage-field">
              <div class="storage-field__label text-xs text-[#6b7280] capitalize mb-[3px] font-medium">{{ t("storage_settings.accessKey") }}</div>
              <div class="storage-field__value break-all" style="font-size: 0.9rem; color: var(--o2-text-primary);">{{ storageData.access_key }}</div>
            </div>
            <div v-if="storageData.secret_key" class="storage-field">
              <div class="storage-field__label text-xs text-[#6b7280] capitalize mb-[3px] font-medium">{{ t("storage_settings.secretKey") }}</div>
              <div class="storage-field__value break-all" style="font-size: 0.9rem; color: var(--o2-text-primary);">{{ storageData.secret_key }}</div>
            </div>
            <div v-if="storageData.role_arn" class="storage-field">
              <div class="storage-field__label text-xs text-[#6b7280] capitalize mb-[3px] font-medium">{{ t("storage_settings.roleArn") }}</div>
              <div class="storage-field__value break-all" style="font-size: 0.9rem; color: var(--o2-text-primary); word-break: break-all;">{{ storageData.role_arn }}</div>
            </div>
          </div>
        </OCardSection>

        <OSeparator v-if="configTimestamps" />

        <!-- Timestamps -->
        <OCardSection v-if="configTimestamps">
          <div class="flex" style="gap: 40px;">
            <div v-if="configTimestamps.created_at" class="flex items-center" style="gap: 6px;">
              <span class="storage-field__label text-xs text-[#6b7280] capitalize font-medium" style="margin-bottom: 0;">{{ t("storage_settings.createdAt") }}</span>
              <span class="text-sm">{{ configTimestamps.created_at }}</span>
            </div>
            <div v-if="configTimestamps.updated_at" class="flex items-center" style="gap: 6px;">
              <span class="storage-field__label text-xs text-[#6b7280] capitalize font-medium" style="margin-bottom: 0;">{{ t("storage_settings.updatedAt") }}</span>
              <span class="text-sm">{{ configTimestamps.updated_at }}</span>
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
import OTag from "@/lib/core/Badge/OTag.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
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
    label: t("settings.orgStorageSettings.awsCredentials"),
    value: "AwsCredentials",
    image: getImageURL("images/org_storage/aws_plain_without_bg.png"),
  },
  {
    label: t("settings.orgStorageSettings.azureCredentials"),
    value: "AzureCredentials",
    image: getImageURL("images/org_storage/azure.png"),
  },
  // {
  //   label: "GCP Credentials",
  //   value: "GcpCredentials",
  //   image: getImageURL("images/org_storage/gcp.png"),
  // },
  {
    label: t("settings.orgStorageSettings.awsRoleArn"),
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
</style>
