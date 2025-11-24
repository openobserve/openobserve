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
        v-for="edition in featureData.editions"
        :key="edition.id"
        class="edition-card"
        :class="{
          'is-current-plan': store.state.zoConfig.build_type === edition.id
        }"
      >
        <!-- Card Header -->
        <div class="card-header">
          <div class="header-content">
            <div class="edition-name">{{ edition.name }}</div>
            <div v-if="store.state.zoConfig.build_type === edition.id" class="current-plan-badge">
              Your Plan
            </div>
          </div>
        </div>

        <!-- Card Body - Feature List -->
        <div class="card-body">
          <div
            v-for="feature in featureData.features"
            :key="feature.name"
            class="feature-item"
          >
            <div class="feature-status">
              <span v-if="feature.values[edition.id] === true" class="status-icon available">
                <q-icon name="check_circle" size="16px" />
              </span>
              <span v-else-if="feature.values[edition.id] === false" class="status-icon unavailable">
                <q-icon name="cancel" size="16px" />
              </span>
              <span v-else class="status-icon text">
                <q-icon name="info" size="14px" />
              </span>
            </div>
            <div class="feature-content">
              <div class="feature-name">{{ feature.name }}</div>
              <div
                v-if="typeof feature.values[edition.id] === 'string'"
                class="feature-detail"
              >
                {{ feature.values[edition.id] }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useStore } from "vuex";

interface FeatureValue {
  opensource: boolean | string;
  enterprise: boolean | string;
  cloud: boolean | string;
}

interface Feature {
  name: string;
  values: FeatureValue;
}

interface Edition {
  id: 'opensource' | 'enterprise' | 'cloud';
  name: string;
}

interface FeatureData {
  editions: Edition[];
  features: Feature[];
}

export default defineComponent({
  name: "FeatureComparisonTable",
  setup() {
    const store = useStore();

    const featureData: FeatureData = {
      editions: [
        { id: 'opensource', name: 'Open Source (Self hosted)' },
        { id: 'enterprise', name: 'Enterprise (Self hosted)' },
        { id: 'cloud', name: 'Cloud' }
      ],
      features: [
        { name: 'Logs', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Metrics', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Traces', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'RUM', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Alerts', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Dashboards', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Reports', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'VRL functions', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Pipelines', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'High Availability', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Multitenancy (Organizations)', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Dynamic schema and schema evolution', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Advanced multilingual GUI', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Single Sign On', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Role Based Access Control (RBAC)', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Federated search / Super cluster', values: { opensource: false, enterprise: true, cloud: false } },
        { name: 'Query management', values: { opensource: false, enterprise: true, cloud: false } },
        { name: 'Workload management (QoS)', values: { opensource: false, enterprise: true, cloud: false } },
        { name: 'Audit trail', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Action Scripts', values: { opensource: false, enterprise: true, cloud: false } },
        { name: 'Sensitive data redaction', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Ability to influence roadmap', values: { opensource: false, enterprise: true, cloud: '✅ on enterprise plan' } },
        { name: 'License', values: { opensource: 'AGPL', enterprise: 'Enterprise', cloud: 'Cloud' } },
        { name: 'Support', values: { opensource: 'Community', enterprise: 'Enterprise', cloud: 'Cloud' } },
        { name: 'Cost', values: { opensource: 'Free', enterprise: 'If self hosted, free for up to 200 GB/Day data ingested. Paid thereafter', cloud: '14 day free trial. Paid thereafter' } },
        { name: 'Pipelines - External destinations', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Extreme performance (100x improvement for many queries)', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Query optimizer', values: { opensource: false, enterprise: true, cloud: true } }
      ]
    };

    const currentPlanName = computed(() => {
      const buildType = store.state.zoConfig.build_type;
      const edition = featureData.editions.find((ed) => ed.id === buildType);
      return edition ? edition.name : "";
    });

    return {
      store,
      featureData,
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
        background: linear-gradient(
          135deg,
          rgba(76, 175, 80, 0.1),
          rgba(33, 150, 243, 0.1)
        );
        border-left: 3px solid #4caf50;
        border-radius: 0.375rem;

        strong {
          font-weight: 600;
          color: #4caf50;
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
    background: var(--q-card-background, #fff);
    transition: all 0.3s ease;
    display: flex;
    flex-direction: column;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }

    &.is-current-plan {
      border: 2px solid var(--o2-theme-color);
      box-shadow: 0 2px 12px rgba(33, 150, 243, 0.15);

      .card-header {
        background: linear-gradient(135deg, var(--o2-theme-color), color-mix(in srgb, var(--o2-theme-color) 80%, #fff 20%));
        color: white;
      }
    }

    .card-header {
      padding: 0.875rem 1rem;
      background: linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(128, 128, 128, 0.04));
      border-bottom: 1px solid rgba(128, 128, 128, 0.15);

      .header-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }

      .edition-name {
        font-size: 1rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        flex: 1;
        min-width: 0;
      }

      .current-plan-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.2rem 0.625rem;
        background: rgba(255, 255, 255, 0.25);
        border-radius: 0.75rem;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
        flex-shrink: 0;
      }
    }

    .card-body {
      padding: 0.75rem 1rem 1rem;
      overflow-y: auto;
      flex: 1;

      .feature-item {
        display: flex;
        align-items: flex-start;
        gap: 0.625rem;
        padding: 0.5rem 0;
        border-bottom: 1px solid rgba(128, 128, 128, 0.08);

        &:last-child {
          border-bottom: none;
        }

        .feature-status {
          flex-shrink: 0;
          margin-top: 0.0625rem;

          .status-icon {
            display: flex;
            align-items: center;
            justify-content: center;

            &.available {
              color: #4caf50;
            }

            &.unavailable {
              color: #f44336;
              opacity: 0.5;
            }

            &.text {
              color: var(--o2-theme-color);
            }
          }
        }

        .feature-content {
          flex: 1;
          min-width: 0;

          .feature-name {
            font-size: 0.8125rem;
            font-weight: 500;
            color: var(--q-text-color);
            line-height: 1.4;
          }

          .feature-detail {
            font-size: 0.6875rem;
            color: var(--q-text-color);
            opacity: 0.7;
            margin-top: 0.2rem;
            line-height: 1.3;
          }
        }
      }
    }
  }

  // Dark theme adjustments
  :deep(.body--dark) {
    .edition-card {
      background: rgba(255, 255, 255, 0.03);
      border-color: rgba(255, 255, 255, 0.1);

      &:hover {
        background: rgba(255, 255, 255, 0.05);
      }

      &.is-current-plan {
        background: rgba(33, 150, 243, 0.05);
      }

      .feature-item {
        border-bottom-color: rgba(255, 255, 255, 0.05);
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
