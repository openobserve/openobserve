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
  <div class="feature-comparison-wrapper">
    <div class="feature-comparison-header tw-mb-6">
      <div class="tw-flex tw-items-center tw-gap-3 tw-mb-3">
        <div class="icon-wrapper" :class="store.state.theme === 'dark' ? 'icon-wrapper-dark' : 'icon-wrapper-light'">
          <q-icon name="compare_arrows" size="24px" />
        </div>
        <h3 class="feature-title">Feature Comparison</h3>
      </div>
      <div class="feature-subtitle-wrapper">
        <p
          v-if="store.state.zoConfig.build_type === 'opensource'"
          class="edition-info"
        >
          You're currently using OpenObserve Open Source Edition. Upgrade to Enterprise Edition to unlock advanced features listed in the comparison table below.
        </p>
        <p
          v-else-if="store.state.zoConfig.build_type === 'enterprise'"
          class="edition-info"
        >
          You're using OpenObserve Enterprise Edition with access to all advanced features listed below.
        </p>
        <p
          v-else
          class="feature-subtitle"
        >
          Compare features across Open Source, Enterprise, and Cloud offerings
        </p>
        <p
          v-if="store.state.zoConfig.build_type === 'opensource'"
          class="enterprise-promotion"
        >
          <strong>Good news:</strong> OpenObserve Enterprise Edition is completely free for up to 200 GB/day (~6 TB/month) of data ingestion.
        </p>
        <p
          v-else-if="store.state.zoConfig.build_type === 'enterprise'"
          class="enterprise-promotion"
        >
          <strong>Your plan:</strong> Enterprise Edition is free for up to 200 GB/day (~6 TB/month) of data ingestion.
        </p>
      </div>
    </div>

    <div class="cards-wrapper">
      <div
        v-for="edition in editions"
        :key="edition.id"
        class="edition-card"
        :class="{
          'is-current-plan': store.state.zoConfig.build_type === edition.id
        }"
      >
        <!-- Card Header -->
        <div class="card-header">
          <div class="header-content">
            <div class="edition-info">
              <div class="edition-name">{{ edition.name }}</div>
              <div class="edition-description">{{ edition.description }}</div>
            </div>
            <div v-if="store.state.zoConfig.build_type === edition.id" class="current-plan-badge">
              Your Plan
            </div>
          </div>
        </div>

        <!-- Card Body -->
        <div class="card-body">
          <!-- Included Features -->
          <div
            v-for="(group, index) in edition.includes"
            :key="index"
            class="feature-group"
          >
            <div class="group-header">
              <q-icon name="check_circle" size="16px" class="header-icon" />
              <span class="group-title">{{ group.title }}</span>
            </div>
            <ul class="feature-list">
              <li
                v-for="(item, itemIndex) in group.items"
                :key="itemIndex"
                class="feature-list-item"
              >
                {{ item }}
              </li>
            </ul>
          </div>

          <!-- Pricing -->
          <div class="pricing-section">
            <q-icon
              :name="edition.pricing.iconName"
              size="20px"
              :color="edition.pricing.iconColor"
              class="pricing-icon"
            />
            <span class="pricing-text">{{ edition.pricing.text }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useStore } from "vuex";

interface FeatureGroup {
  title: string;
  items: string[];
}

interface EditionInfo {
  id: 'opensource' | 'enterprise' | 'cloud';
  name: string;
  description: string;
  includes: FeatureGroup[];
  pricing: {
    iconName: string;
    iconColor: string;
    text: string;
  };
}

export default defineComponent({
  name: "FeatureComparisonTable",
  setup() {
    const store = useStore();

    const editions: EditionInfo[] = [
      {
        id: 'opensource',
        name: 'Open Source',
        description: 'Self-hosted',
        includes: [
          {
            title: 'Core Observability',
            items: ['Logs, Metrics, Traces & RUM', 'Alerts & Dashboards', 'Reports & Pipelines']
          },
          {
            title: 'Platform Features',
            items: ['High Availability', 'Multitenancy (Organizations)', 'Dynamic schema evolution', 'Advanced multilingual GUI', 'VRL functions']
          },
          {
            title: 'License & Support',
            items: ['AGPL License', 'Community Support']
          }
        ],
        pricing: {
          iconName: 'celebration',
          iconColor: 'var(--o2-primary-btn-bg)',
          text: 'Free forever'
        }
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        description: 'Everything in Open Source, plus:',
        includes: [
          {
            title: 'Security & Access',
            items: ['Single Sign On (SSO)', 'Role Based Access Control (RBAC)', 'Audit trail', 'Sensitive data redaction']
          },
          {
            title: 'Advanced Features',
            items: ['Federated search / Super cluster', 'Query management', 'Workload management (QoS)', 'Action Scripts', 'Pipelines - External destinations']
          },
          {
            title: 'Performance',
            items: ['Extreme performance (100x improvement)', 'Query optimizer']
          },
          {
            title: 'Additional Benefits',
            items: ['Enterprise License', 'Enterprise Support', 'Ability to influence roadmap']
          }
        ],
        pricing: {
          iconName: 'card_giftcard',
          iconColor: 'var(--o2-primary-btn-bg)',
          text: 'Free up to 200 GB/day (~6 TB/month)'
        }
      },
      {
        id: 'cloud',
        name: 'Cloud',
        description: 'Fully managed OpenObserve with comprehensive features:',
        includes: [
          {
            title: 'Core Observability',
            items: ['Logs, Metrics, Traces & RUM', 'Alerts, Dashboards & Reports', 'Pipelines with external destinations', 'VRL functions']
          },
          {
            title: 'Platform Features',
            items: ['High Availability', 'Multitenancy (Organizations)', 'Dynamic schema evolution', 'Advanced multilingual GUI']
          },
          {
            title: 'Security & Performance',
            items: ['SSO & RBAC', 'Audit trail', 'Sensitive data redaction', 'Query optimizer', 'Extreme performance improvements']
          },
          {
            title: 'Cloud Benefits',
            items: ['Auto-scaling & managed infrastructure', 'Cloud License', 'Cloud Support', 'Ability to influence roadmap (on enterprise plan)']
          }
        ],
        pricing: {
          iconName: 'payments',
          iconColor: 'var(--o2-primary-btn-bg)',
          text: '14-day free trial, pay as you go'
        }
      }
    ];

    const currentPlanName = computed(() => {
      const buildType = store.state.zoConfig.build_type;
      const edition = editions.find((ed: EditionInfo) => ed.id === buildType);
      return edition ? edition.name : "";
    });

    return {
      store,
      editions,
      currentPlanName,
    };
  }
});
</script>

<style lang="scss" scoped>
.feature-comparison-wrapper {
  padding: 0.1rem;

  .feature-comparison-header {
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

    .feature-subtitle-wrapper {
      .feature-subtitle {
        font-size: 0.9375rem;
        line-height: 1.8;
        opacity: 0.8;
        margin-bottom: 0;

        strong {
          font-weight: 600;
          opacity: 1;
        }
      }

      .edition-info {
        font-size: 0.9375rem;
        line-height: 1.8;
        opacity: 0.9;
        margin-bottom: 0;
      }

      .enterprise-promotion {
        font-size: 0.9375rem;
        line-height: 1.8;
        margin-top: 0.5rem;
        margin-bottom: 0;
        padding: 0.75rem 1rem;
        background: color-mix(in srgb, var(--o2-primary-btn-bg) 10%, transparent 90%);
        border-left: 3px solid var(--o2-primary-btn-bg);
        border-radius: 0.375rem;

        strong {
          font-weight: 600;
          color: var(--o2-primary-btn-bg);
        }
      }
    }
  }

  .cards-wrapper {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-top: 1rem;
  }

  .edition-card {
    border: 1px solid rgba(128, 128, 128, 0.2);
    border-radius: 0.5rem;
    overflow: hidden;
    background: var(--q-card-background);
    transition: all 0.3s ease;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }

    &.is-current-plan {
      border: 2px solid var(--o2-primary-btn-bg);
      box-shadow: 0 2px 12px rgba(33, 150, 243, 0.15);

      .card-header {
        background: linear-gradient(135deg, var(--o2-primary-btn-bg), color-mix(in srgb, var(--o2-primary-btn-bg) 80%, #fff 20%));
        color: white;
      }
    }

    .card-header {
      padding: 0.875rem 1rem;
      background: linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(128, 128, 128, 0.04));
      border-bottom: 1px solid rgba(128, 128, 128, 0.15);

      .header-content {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .edition-info {
        flex: 1;
        min-width: 0;

        .edition-name {
          font-size: 1.125rem;
          font-weight: 600;
          letter-spacing: -0.01em;
          margin-bottom: 0.25rem;
        }

        .edition-description {
          font-size: 0.75rem;
          opacity: 0.85;
          line-height: 1.3;
        }
      }

      .current-plan-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.25rem 0.75rem;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 1rem;
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        white-space: nowrap;
        flex-shrink: 0;
        color: var(--o2-primary-btn-bg);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.4);

        &::before {
          content: "★";
          font-size: 0.75rem;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.1);
          }
        }
      }
    }

    .card-body {
      padding: 1rem;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1rem;

      .feature-group {
        .group-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;

          .header-icon {
            color: var(--o2-primary-btn-bg);

            &.unavailable {
              color: var(--q-negative);
              opacity: 0.5;
            }
          }

          .group-title {
            font-size: 0.8125rem;
            font-weight: 600;
            color: var(--q-text-color);
            text-transform: uppercase;
            letter-spacing: 0.03em;
            opacity: 0.9;
          }
        }

        .feature-list {
          list-style: none;
          padding: 0;
          margin: 0 0 0 1.75rem;

          .feature-list-item {
            font-size: 0.8125rem;
            line-height: 1.6;
            color: var(--q-text-color);
            opacity: 0.85;
            margin-bottom: 0.375rem;
            position: relative;
            padding-left: 0.75rem;

            &::before {
              content: "•";
              position: absolute;
              left: 0;
              color: var(--o2-primary-btn-bg);
              font-weight: bold;
            }

            &:last-child {
              margin-bottom: 0;
            }
          }
        }
      }

      .pricing-section {
        margin-top: auto;
        padding-top: 1rem;
        border-top: 1px solid rgba(128, 128, 128, 0.1);
        display: flex;
        align-items: center;
        gap: 0.625rem;

        .pricing-icon {
          flex-shrink: 0;
        }

        .pricing-text {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--q-text-color);
          line-height: 1.4;
        }
      }
    }
  }

  // Dark theme adjustments
  :deep(.body--dark) {
    .edition-card {
      background: rgba(255, 255, 255, 0.03) !important;
      border-color: rgba(255, 255, 255, 0.1) !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3) !important;

      &:hover {
        background: rgba(255, 255, 255, 0.05) !important;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4) !important;
      }

      &.is-current-plan {
        background: rgba(33, 150, 243, 0.08) !important;
        border-color: var(--o2-primary-btn-bg) !important;
        box-shadow: 0 4px 16px rgba(33, 150, 243, 0.3) !important;
      }

      .card-header {
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02)) !important;
        border-bottom-color: rgba(255, 255, 255, 0.1);

        .edition-description {
          opacity: 0.75;
        }

        .current-plan-badge {
          background: rgba(255, 255, 255, 0.15) !important;
          color: #fff !important;
          border-color: rgba(255, 255, 255, 0.25);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        }
      }

      .feature-list-item {
        opacity: 0.8;

        &::before {
          opacity: 0.9;
        }
      }

      .pricing-section {
        border-top-color: rgba(255, 255, 255, 0.08);
      }
    }
  }

  // Responsive design
  @media (max-width: 1024px) {
    .cards-wrapper {
      grid-template-columns: 1fr;
      gap: 1rem;
    }

    .edition-card {
      &:hover {
        transform: none;
      }
    }
  }

  @media (max-width: 768px) {
    padding: 0.5rem;

    .cards-wrapper {
      gap: 0.75rem;
    }

    .edition-card {
      .card-header {
        padding: 1rem;

        .edition-name {
          font-size: 1rem;
        }
      }

      .card-body {
        padding: 0.75rem 1rem 1rem;

        .feature-item {
          padding: 0.5rem 0;
          gap: 0.5rem;

          .feature-content {
            .feature-name {
              font-size: 0.8125rem;
            }

            .feature-detail {
              font-size: 0.6875rem;
            }
          }
        }
      }
    }
  }
}
</style>
