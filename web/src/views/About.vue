<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page class="tw-w-full tw-h-full tw-px-[0.625rem] tw-pb-[0.625rem] aboutPage q-pt-xs">
    <div class="card-container tw-h-[calc(100vh-50px)] tw-overflow-auto">
      <div class="q-px-sm q-pt-sm tw-h-full">
        <!-- Hero Section -->
        <div class="hero-section">
          <div class="tw-flex tw-flex-col md:tw-flex-row tw-items-center tw-justify-between tw-gap-8">
            <div class="tw-flex-1">
              <img
                :src="
                  store.state.theme == 'dark'
                    ? getImageURL('images/common/openobserve_latest_dark_2.svg')
                    : getImageURL('images/common/openobserve_latest_light_2.svg')
                "
                class="logo"
                width="220"
              />
              <p class="tagline tw-mt-4">{{ t("about.logoMsg") }}</p>
              <div class="tw-flex tw-gap-3 tw-mt-6">
                <div class="version-badge" :class="store.state.theme === 'dark' ? 'version-badge-dark' : 'version-badge-light'">
                  <span>{{ store.state.zoConfig.version }}</span>
                </div>
                <div class="build-badge tw-capitalize" :class="store.state.theme === 'dark' ? 'build-badge-dark' : 'build-badge-light'">
                  <q-icon name="workspaces" size="20px" />
                  <span>{{ store.state.zoConfig.build_type }}</span>
                </div>
              </div>
            </div>
            <div class="stats-grid">
              <div class="stat-card stat-card-commit" :class="store.state.theme === 'dark' ? 'stat-card-commit-dark' : 'stat-card-commit-light'">
                <q-icon name="code" size="32px" class="stat-icon" />
                <div class="stat-label">Commit</div>
                <div class="stat-value tw-font-mono">{{ store.state.zoConfig.commit_hash }}</div>
              </div>
              <div class="stat-card stat-card-built" :class="store.state.theme === 'dark' ? 'stat-card-built-dark' : 'stat-card-built-light'">
                <q-icon name="event" size="32px" class="stat-icon" />
                <div class="stat-label">Built</div>
                <div class="stat-value">{{ formatDate(store.state.zoConfig.build_date) }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Features Grid -->
        <div class="tw-grid tw-grid-cols-1 md:tw-grid-cols-2 tw-gap-4">
          <!-- Open Source Libraries -->
          <div class=" feature-card">
            <div class="tw-mb-4">
              <div class="tw-flex tw-items-center tw-gap-3 tw-mb-3">
                <div class="icon-wrapper" :class="store.state.theme === 'dark' ? 'icon-wrapper-dark' : 'icon-wrapper-light'">
                  <q-icon name="code" size="24px" />
                </div>
                <h3 class="feature-title">Open Source Libraries</h3>
              </div>
              <p class="feature-text">
                Built on the shoulders of giants. OpenObserve depends on many amazing open source libraries.
              </p>
            </div>
            <div class="tw-flex tw-flex-wrap tw-gap-2">
              <a
                href="https://github.com/openobserve/openobserve/blob/main/Cargo.toml"
                target="_blank"
                class="link-badge"
              >
                <q-icon name="settings" size="16px" class="tw-mr-1" />
                Cargo.toml
              </a>
              <a
                href="https://github.com/openobserve/openobserve/blob/main/web/package.json"
                target="_blank"
                class="link-badge"
              >
              <q-icon name="backpack" class="tw-mr-1" />
                package.json
              </a>
              <a href="https://npmjs.com" target="_blank" class="link-badge">
                <q-icon name="javascript" size="16px" class="tw-mr-1" />
                npmjs.com
              </a>
              <a href="https://crates.io" target="_blank" class="link-badge">
                <q-icon name="inventory_2" size="16px" class="tw-mr-1" />
                crates.io
              </a>
            </div>
          </div>

          <!-- License Info -->
          <div
            v-if="store.state.zoConfig.build_type == 'opensource' || (store.state.zoConfig.build_type == 'enterprise' && config.isCloud == 'false')"
            class=" feature-card license-feature"
          >
            <div class="tw-mb-4">
              <div class="tw-flex tw-items-center tw-gap-3 tw-mb-3">
                <div class="icon-wrapper" :class="store.state.theme === 'dark' ? 'icon-wrapper-dark' : 'icon-wrapper-light'">
                  <q-icon name="shield" size="24px" />
                </div>
                <h3 class="feature-title">License Information</h3>
              </div>
              <p v-if="store.state.zoConfig.build_type == 'opensource'" class="feature-text">
                You are using the <strong>open source version</strong> under the
                <a
                  href="https://github.com/openobserve/openobserve/blob/main/LICENSE"
                  target="_blank"
                  class="inline-link"
                >GNU Affero General Public License (AGPL)</a>.
              </p>
              <p v-if="store.state.zoConfig.build_type == 'enterprise' && config.isCloud == 'false'" class="feature-text">
                You are using the <strong>Enterprise version</strong> governed by the
                <a
                  href="https://openobserve.ai/enterprise-license/"
                  target="_blank"
                  class="inline-link"
                >enterprise license agreement</a>.
              </p>
            </div>
            <div class="tw-mt-4 tw-p-3 tw-rounded tw-bg-opacity-10" :class="store.state.theme === 'dark' ? 'tw-bg-blue-400' : 'tw-bg-blue-500'">
              <p class="tw-text-sm tw-mb-0">
                <q-icon name="info" size="16px" class="tw-mr-1" />
                By using OpenObserve, you agree to comply with the applicable license terms.
              </p>
            </div>
          </div>

          <!-- Community Card (if no license card) -->
          <div
            v-else
            class=" feature-card"
          >
            <div class="tw-mb-4" style="min-height: 120px;">
              <div class="tw-flex tw-items-center tw-gap-3 tw-mb-3">
                <div class="icon-wrapper" :class="store.state.theme === 'dark' ? 'icon-wrapper-dark' : 'icon-wrapper-light'">
                  <q-icon name="groups" size="24px" />
                </div>
                <h3 class="feature-title">Community</h3>
              </div>
              <p class="feature-text">
                Join our vibrant community of developers and users building the future of observability.
              </p>
            </div>
            <div class="tw-flex tw-flex-wrap tw-gap-2">
              <a href="https://github.com/openobserve/openobserve" target="_blank" class="link-badge">
                <q-icon name="code" size="16px" class="tw-mr-1" />
                GitHub
              </a>
              <a href="https://openobserve.ai" target="_blank" class="link-badge">
                <q-icon name="language" size="16px" class="tw-mr-1" />
                Website
              </a>
            </div>
          </div>
        </div>

        <!-- Feature Comparison Table -->
        <div class="tw-mt-6">
          <FeatureComparisonTable />
        </div>
      </div>
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useStore } from "vuex";
import { getImageURL } from "../utils/zincutils";
import { useI18n } from "vue-i18n";
import config from "@/aws-exports";
import FeatureComparisonTable from "@/components/about/FeatureComparisonTable.vue";

export default defineComponent({
  name: "PageAbout",
  components: {
    FeatureComparisonTable,
  },
  setup() {
    const store = useStore();
    const pageData = ref("Page Data");
    const { t } = useI18n();

    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    };

    return {
      t,
      store,
      config,
      pageData,
      getImageURL,
      formatDate,
    };
  },
});
</script>

<style lang="scss" scoped>
.aboutPage {
  // Hero Section
  .hero-section {
    padding: 0.1rem;
    margin-bottom: 1rem;

    .logo {
      display: block;
    }

    .tagline {
      font-size: 1.25rem;
      font-weight: 500;
      opacity: 0.85;
      margin: 0;
      line-height: 1.6;
    }

    .version-badge,
    .build-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1.25rem;
      border-radius: 0.375rem;
      font-weight: 600;
      font-size: 0.9375rem;
      transition: all 0.3s ease;

      &:hover {
        transform: translateY(-2px);
      }
    }

    .version-badge-dark {
      background: rgba(76, 175, 80, 0.2);
      color: #81C784;
      border: 1px solid rgba(76, 175, 80, 0.3);
    }

    .version-badge-light {
      background: rgba(76, 175, 80, 0.12);
      color: #2E7D32;
      border: 1px solid rgba(76, 175, 80, 0.25);
    }

    .build-badge-dark {
      background: rgba(33, 150, 243, 0.2);
      color: #64B5F6;
      border: 1px solid rgba(33, 150, 243, 0.3);
    }

    .build-badge-light {
      background: rgba(33, 150, 243, 0.12);
      color: #1565C0;
      border: 1px solid rgba(33, 150, 243, 0.25);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;

      .stat-card {
        padding: 1.75rem;
        text-align: center;
        transition: all 0.3s ease;
        position: relative;
        overflow: hidden;
        border-radius: 0.375rem;
        border: 1.5px solid;

        &:hover {
          transform: translateY(-4px);
        }

        .stat-icon {
          margin-bottom: 1rem;
        }

        .stat-label {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: 700;
          margin-bottom: 0.5rem;
          opacity: 0.9;
        }

        .stat-value {
          font-size: 1.125rem;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
      }

      .stat-card-commit-dark {
        background: linear-gradient(135deg, rgba(156, 39, 176, 0.15) 0%, rgba(123, 31, 162, 0.1) 100%);
        border-color: rgba(156, 39, 176, 0.3);
        color: #CE93D8;

        .stat-icon {
          color: #BA68C8;
        }
      }

      .stat-card-commit-light {
        background: linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(123, 31, 162, 0.05) 100%);
        border-color: rgba(156, 39, 176, 0.25);
        color: #6A1B9A;

        .stat-icon {
          color: #8E24AA;
        }
      }

      .stat-card-built-dark {
        background: linear-gradient(135deg, rgba(255, 152, 0, 0.15) 0%, rgba(251, 140, 0, 0.1) 100%);
        border-color: rgba(255, 152, 0, 0.3);
        color: #FFB74D;

        .stat-icon {
          color: #FFA726;
        }
      }

      .stat-card-built-light {
        background: linear-gradient(135deg, rgba(255, 152, 0, 0.08) 0%, rgba(251, 140, 0, 0.05) 100%);
        border-color: rgba(255, 152, 0, 0.25);
        color: #E65100;

        .stat-icon {
          color: #F57C00;
        }
      }
    }
  }

  // Feature Cards
  .feature-card1 {
    padding: 2rem;
    transition: all 0.3s ease;
    position: relative;
    border: 1px solid;
    border-radius: 0.375rem;

    &:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
    }
    border: 0.0625rem solid var(--o2-border-color);
  }


  .feature-card {
    .icon-wrapper {
      width: 56px;
      height: 56px;
      border-radius: 0.375rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
    }

    .icon-wrapper-dark {
      background: rgba(33, 150, 243, 0.18);
      color: #64B5F6;
    }

    .icon-wrapper-light {
      background: rgba(33, 150, 243, 0.12);
      color: #1565C0;
    }

    .feature-title {
      font-size: 1.375rem;
      font-weight: 600;
      margin: 0;
      letter-spacing: -0.02em;
    }

    .feature-text {
      font-size: 0.9375rem;
      line-height: 1.8;
      opacity: 0.8;
      margin-bottom: 0;
    }

    .link-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.625rem 1.125rem;
      border-radius: 0.375rem;
      background: rgba(33, 150, 243, 0.08);
      color: var(--q-primary);
      text-decoration: none;
      font-size: 0.875rem;
      font-weight: 600;
      transition: all 0.25s ease;
      border: 1.5px solid rgba(33, 150, 243, 0.2);

      &:hover {
        background: rgba(33, 150, 243, 0.15);
        border-color: rgba(33, 150, 243, 0.35);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(33, 150, 243, 0.15);
      }
    }

    .external-link {
      display: inline-flex;
      align-items: center;
      color: var(--q-primary);
      text-decoration: none;
      font-size: 0.875rem;
      opacity: 0.8;
      transition: all 0.2s ease;

      &:hover {
        opacity: 1;
        text-decoration: underline;
      }
    }

    .inline-link {
      color: var(--q-primary);
      text-decoration: none;
      font-weight: 600;
      border-bottom: 1px solid transparent;
      transition: all 0.2s ease;

      &:hover {
        border-bottom-color: var(--q-primary);
      }
    }
  }

  // Responsive
  @media (max-width: 768px) {
    .hero-section {
      padding: 1.5rem;

      .stats-grid {
        grid-template-columns: 1fr;
        width: 100%;
      }
    }

    .feature-card {
      padding: 1.5rem;
    }
  }
}
</style>
