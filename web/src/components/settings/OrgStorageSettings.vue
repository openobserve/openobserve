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
    <div
        class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-4 tw:border-b-[1px]"
      >
        <div class="q-table__title tw:font-[600]">
          {{ t('storage_settings.title') }}
        </div>
      </div>
    <!-- Loading state -->
    <div v-if="loading" class="flex justify-center items-center" style="min-height: calc(100vh - var(--navbar-height) - 120px)">
      <q-spinner color="primary" size="2em" />
    </div>

    <!-- Cloud: storage not enabled -->
    <div
      v-else-if="isCloud && !orgStorageEnabled"
      class="text-body2 text-grey q-py-md"
    >
      {{ t('storage_settings.notEnabled') }}
    </div>

    <!-- ========== NOT CONFIGURED: cloud hero ========== -->
    <div
      v-else-if="!isConfigured && isCloud"
      class="hero-page"
      :class="store.state.theme === 'dark' ? 'hero-page--dark' : ''"
    >
      <div class="hero-page__body">
        <!-- left -->
        <div class="hero-page__left">

          <div class="hero-page__headline">
            {{ t("storage_settings.heroHeadline") }} <span class="hero-page__brand-text">OpenObserve.</span>
          </div>

          <div class="hero-page__sub">
            {{ t("storage_settings.heroSub") }}
          </div>

          <div class="hero-page__actions">
            <OButton
              data-test="storage-settings-configure-btn"
              variant="primary"
              class="no-border o2-primary-button hero-cta-btn"
              :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
              @click="navigateToCreate"
            >
              {{ t("storage_settings.configureStorage") }}
            </OButton>
          </div>

          <!-- supported infrastructure -->
          <div class="hero-page__inline-providers">
            <span class="hero-page__inline-label">{{ t("storage_settings.supportedProviders") }}</span>
            <div class="hero-page__inline-logos">
              <div
                v-for="p in availableProviders"
                :key="p.value"
                class="hero-page__inline-logo-wrap"
              >
                <img :src="p.image" :alt="p.label" class="hero-page__inline-logo" />
                <q-tooltip>{{ p.label }}</q-tooltip>
              </div>
            </div>
          </div>
        </div>

        <!-- right: feature cards -->
        <div class="hero-page__right">
          <div
            v-for="feature in features"
            :key="feature.title"
            class="feature-card"
            :class="store.state.theme === 'dark' ? 'feature-card--dark' : ''"
          >
            <div class="feature-card__icon-box" :class="store.state.theme === 'dark' ? 'feature-card__icon-box--dark' : ''">
              <q-icon :name="feature.icon" size="20px" class="feature-card__icon" />
            </div>
            <div class="feature-card__content">
              <div class="feature-card__title">{{ feature.title }}</div>
              <div class="feature-card__desc">{{ feature.desc }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== NOT CONFIGURED: enterprise empty state ========== -->
    <div
      v-else-if="!isConfigured && !isCloud"
      class="ent-empty"
      :class="store.state.theme === 'dark' ? 'ent-empty--dark' : ''"
    >
      <!-- double-ring icon -->
      <div class="ent-empty__icon-outer">
        <div class="ent-empty__icon-inner" :class="store.state.theme === 'dark' ? 'ent-empty__icon-inner--dark' : ''">
          <q-icon name="cloud_upload" size="28px" class="ent-empty__icon" />
        </div>
      </div>

      <div class="ent-empty__title">{{ t("storage_settings.noStorageConfigured") }}</div>

      <div class="ent-empty__desc">
        {{ t("storage_settings.routeDataDesc") }}
      </div>

      <!-- key fact chips -->
      <div class="ent-empty__chips">
        <span class="ent-empty__chip" :class="store.state.theme === 'dark' ? 'ent-empty__chip--dark' : ''">
          <q-icon name="corporate_fare" size="13px" />
          {{ t("storage_settings.perOrgIsolation") }}
        </span>
        <span class="ent-empty__chip" :class="store.state.theme === 'dark' ? 'ent-empty__chip--dark' : ''">
          <q-icon name="bolt" size="13px" />
          {{ t("storage_settings.appliesImmediately") }}
        </span>
        <span class="ent-empty__chip" :class="store.state.theme === 'dark' ? 'ent-empty__chip--dark' : ''">
          <q-icon name="lock" size="13px" />
          {{ t("storage_settings.usesOrgCredentials") }}
        </span>
      </div>

      <OButton
        data-test="storage-settings-configure-btn"
        variant="primary"
        class="no-border o2-primary-button ent-empty__btn"
        :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
        @click="navigateToCreate"
      >
        {{ t("storage_settings.configureStorage") }}
      </OButton>

      <div class="ent-empty__providers">
        <span class="ent-empty__providers-label">{{ t("storage_settings.supportedProviders") }}</span>
        <div class="ent-empty__providers-logos">
          <div
            v-for="p in providerDefinitions"
            :key="p.value"
            class="ent-empty__logo-wrap"
          >
            <img :src="p.image" :alt="p.label" class="ent-empty__logo" />
            <q-tooltip>{{ p.label }}</q-tooltip>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== CONFIGURED ========== -->
    <div v-else>

      <div class="q-pa-md">
      <q-card
        flat
        bordered
        class="storage-card"
        :class="store.state.theme === 'dark' ? 'storage-card--dark' : ''"
        style="max-width: 680px;"
      >
        <!-- Card header: logo + name + badge | update button -->
        <q-card-section class="row items-center justify-between q-py-md q-px-lg no-wrap">
          <div class="row items-center no-wrap" style="gap: 14px;">
            <img
              :src="configuredProviderImage"
              :alt="configuredProviderLabel"
              style="width: 44px; height: 44px; object-fit: contain; flex-shrink: 0;"
            />
            <div>
              <div class="text-subtitle1" style="font-weight: 700; line-height: 1.3;">
                {{ configuredProviderLabel }}
              </div>
              <q-badge
                color="positive"
                style="font-size: 11px; border-radius: 20px; padding: 2px 8px; margin-top: 4px;"
              >
                <q-icon name="check_circle" size="11px" style="margin-right: 3px;" />
                {{ t("storage_settings.active") }}
              </q-badge>
            </div>
          </div>
          <OButton
            data-test="storage-settings-update-btn"
            variant="primary"
            class="no-border o2-primary-button tw:h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            @click="navigateToEdit"
          >
            {{ t("storage_settings.updateStorage") }}
          </OButton>
        </q-card-section>

        <q-separator />

        <!-- Field grid -->
        <q-card-section class="q-px-lg q-pt-md q-pb-md">
          <div class="storage-detail-grid">
            <div v-if="storageData.bucket_name" class="storage-field">
              <div class="storage-field__label">{{ t("storage_settings.bucketName") }}</div>
              <div class="storage-field__value">{{ storageData.bucket_name }}</div>
            </div>
            <div v-if="storageData.region" class="storage-field">
              <div class="storage-field__label">{{ t("storage_settings.region") }}</div>
              <div class="storage-field__value">{{ storageData.region }}</div>
            </div>
            <div v-if="storageData.server_url && !isCloud" class="storage-field">
              <div class="storage-field__label">{{ t("storage_settings.serverUrl") }}</div>
              <div class="storage-field__value">{{ storageData.server_url }}</div>
            </div>
            <div v-if="storageData.access_key" class="storage-field">
              <div class="storage-field__label">{{ t("storage_settings.accessKey") }}</div>
              <div class="storage-field__value">{{ storageData.access_key }}</div>
            </div>
            <div v-if="storageData.secret_key" class="storage-field">
              <div class="storage-field__label">{{ t("storage_settings.secretKey") }}</div>
              <div class="storage-field__value">{{ storageData.secret_key }}</div>
            </div>
            <div v-if="storageData.role_arn" class="storage-field">
              <div class="storage-field__label">{{ t("storage_settings.roleArn") }}</div>
              <div class="storage-field__value" style="word-break: break-all;">{{ storageData.role_arn }}</div>
            </div>
          </div>
        </q-card-section>

        <q-separator v-if="configTimestamps" />

        <!-- Timestamps -->
        <q-card-section v-if="configTimestamps" class="q-px-lg q-py-sm">
          <div class="row" style="gap: 40px;">
            <div v-if="configTimestamps.created_at" class="row items-center" style="gap: 6px;">
              <span class="storage-field__label" style="margin-bottom: 0;">{{ t("storage_settings.createdAt") }}</span>
              <span class="text-body2">{{ configTimestamps.created_at }}</span>
            </div>
            <div v-if="configTimestamps.updated_at" class="row items-center" style="gap: 6px;">
              <span class="storage-field__label" style="margin-bottom: 0;">{{ t("storage_settings.updatedAt") }}</span>
              <span class="text-body2">{{ configTimestamps.updated_at }}</span>
            </div>
          </div>
        </q-card-section>
      </q-card>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import orgStorageService from "@/services/org_storage";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";

const store = useStore();
const { t } = useI18n();
const router = useRouter();

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
  {
    label: "GCP Credentials",
    value: "GcpCredentials",
    image: getImageURL("images/org_storage/gcp.png"),
  },
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
  router.push({
    name: "storageSettingsEditor",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
}

function navigateToEdit() {
  router.push({
    name: "storageSettingsEditor",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
      edit: "true",
    },
  });
}

onMounted(() => {
  fetchExistingConfig();
});
</script>

<style lang="scss" scoped>
// ── Hero page ─────────────────────────────────────────────────────────────────
.hero-page {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - var(--navbar-height) - 100px);

  &__body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 56px;
    flex: 1;
    padding: 72px 80px;
  }

  // ── Left ────────────────────────────────────────────────────────────────
  &__left {
    flex: 1;
    max-width: 480px;
  }

  &__eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 1.2px;
    text-transform: none;
    color: var(--q-primary);
    background: rgba(66, 133, 244, 0.1);
    border: 1px solid rgba(66, 133, 244, 0.25);
    padding: 4px 10px;
    border-radius: 20px;
    margin-bottom: 20px;
  }

  &__headline {
    font-size: 2.6rem;
    font-weight: 800;
    line-height: 1.2;
    letter-spacing: -0.6px;
    color: #111827;
    margin-bottom: 18px;

    .hero-page--dark & {
      color: #f1f1f5;
    }
  }

  &__brand-text {
    color: var(--q-primary);
  }

  &__brand-logo {
    width: 28px;
    height: 22px;
    object-fit: contain;
    display: inline-block;
    vertical-align: middle;
    position: relative;
    top: -2px;
  }

  &__sub {
    font-size: 0.97rem;
    line-height: 1.7;
    color: #6b7280;
    margin-bottom: 36px;
    max-width: 400px;

    .hero-page--dark & {
      color: #9ca3af;
    }
  }

  &__actions {
    margin-bottom: 28px;
  }

  // provider logos inline beneath the CTA
  &__inline-providers {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__inline-label {
    font-size: 0.8rem;
    font-weight: 500;
    letter-spacing: 0px;
    color: #aaa;
    white-space: nowrap;

    .hero-page--dark & {
      color: #666;
    }
  }

  &__inline-logos {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__inline-logo-wrap {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    cursor: default;
    opacity: 0.7;
    transition: opacity 0.15s;

    &:hover {
      opacity: 1;
    }
  }

  &__inline-logo {
    width: 28px;
    height: 28px;
    max-width: 28px;
    max-height: 28px;
    object-fit: contain;
    display: block;
  }

  // ── Right ────────────────────────────────────────────────────────────────
  &__right {
    width: 340px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
}

.hero-cta-btn {
  height: 44px;
  padding: 0 28px;
  font-size: 0.95rem;
  font-weight: 600;
}

// ── Feature cards (right side) ────────────────────────────────────────────────
.feature-card {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 20px 22px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 1);
  border: 1px solid rgba(0, 0, 0, 0.07);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.2s ease, transform 0.2s ease;

  &:hover {
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.1);
    transform: translateY(-1px);
  }

  &--dark {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.08);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  }

  &__icon-box {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: rgba(66, 133, 244, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    &--dark {
      background: rgba(66, 133, 244, 0.15);
    }
  }

  &__icon {
    color: var(--q-primary);
    opacity: 0.85;
  }

  &__content {
    padding-top: 2px;
    flex: 1;
  }

  &__title {
    font-size: 0.92rem;
    font-weight: 700;
    color: #111827;
    margin-bottom: 5px;

    .feature-card--dark & {
      color: #f3f4f6;
    }
  }

  &__desc {
    font-size: 0.8rem;
    color: #6b7280;
    line-height: 1.55;

    .feature-card--dark & {
      color: #9ca3af;
    }
  }
}

// ── Enterprise empty state ────────────────────────────────────────────────────
.ent-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - var(--navbar-height) - 160px);
  padding: 48px 24px;
  text-align: center;

  // double-ring: outer halo
  &__icon-outer {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    border: 1px dashed rgba(66, 133, 244, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 28px;

    .ent-empty--dark & {
      border-color: rgba(66, 133, 244, 0.3);
    }
  }

  // inner solid ring
  &__icon-inner {
    width: 68px;
    height: 68px;
    border-radius: 50%;
    background: rgba(66, 133, 244, 0.09);
    border: 1.5px solid rgba(66, 133, 244, 0.22);
    display: flex;
    align-items: center;
    justify-content: center;

    &--dark {
      background: rgba(66, 133, 244, 0.18);
      border-color: rgba(66, 133, 244, 0.35);
    }
  }

  &__icon {
    color: var(--q-primary);
    opacity: 0.85;
  }

  &__title {
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: -0.2px;
    color: #111827;
    margin-bottom: 10px;

    .ent-empty--dark & {
      color: #f1f1f5;
    }
  }

  &__desc {
    font-size: 0.88rem;
    line-height: 1.65;
    color: #6b7280;
    max-width: 400px;
    margin-bottom: 24px;

    .ent-empty--dark & {
      color: #9ca3af;
    }
  }

  // fact chips row
  &__chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: 32px;
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.75rem;
    font-weight: 500;
    color: #6b7280;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 20px;
    padding: 4px 12px;

    &--dark {
      color: #9ca3af;
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.1);
    }
  }

  &__btn {
    height: 40px;
    padding: 0 24px;
    font-size: 0.92rem;
    font-weight: 600;
    margin-bottom: 36px;
  }

  &__providers {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__providers-label {
    font-size: 0.78rem;
    font-weight: 500;
    color: #aaa;
    white-space: nowrap;

    .ent-empty--dark & {
      color: #666;
    }
  }

  &__providers-logos {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__logo-wrap {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    cursor: default;
    opacity: 0.65;
    transition: opacity 0.15s;

    &:hover {
      opacity: 1;
    }
  }

  &__logo {
    width: 28px;
    height: 28px;
    max-width: 28px;
    max-height: 28px;
    object-fit: contain;
    display: block;
  }
}

// ── Configured card ───────────────────────────────────────────────────────────
.storage-card {
  border-radius: 12px;

  &--dark {
    background: #1e1e1e;
  }
}

.storage-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px 32px;
}

.storage-field {
  &__label {
    font-size: 0.75rem;
    color: #6b7280;
    text-transform: capitalize;
    margin-bottom: 3px;
    font-weight: 500;
  }

  &__value {
    font-size: 0.9rem;
    color: var(--o2-text-primary);
    word-break: break-all;
  }
}
</style>
