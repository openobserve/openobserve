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
  <OCard
    class="border-card-glass-border bg-card-glass-bg rounded-default dark:bg-surface-base dark:border-border-default row-span-7 grid! h-full w-full grid-rows-subgrid gap-0 border shadow-none max-lg:row-span-1 max-lg:flex!"
  >
    <div class="flex items-start justify-between gap-3 px-4 py-3">
      <div>
        <h3 class="text-text-heading m-0 text-base leading-6 font-semibold">
          {{ t("billing.proPlanLabel") }}
        </h3>
        <p class="text-text-secondary m-0 text-xs leading-4 font-normal">
          {{ t("billing.proPlanSubtitle") }}
        </p>
      </div>
      <OTag v-if="planType == planName" type="billingTag" value="subscribed" class="shrink-0" />
    </div>

    <!-- Always rendered: the card is a subgrid row, so the price slot must exist even when empty. -->
    <div :class="{ 'px-4 pb-3': pricingOptions?.length }">
      <div
        v-if="pricingOptions?.length"
        class="grid h-full grid-cols-1 gap-1.5 md:grid-cols-2"
        data-test="billing-plans-pro-price-options"
      >
        <!-- The first option is what Subscribe buys; the rest are contract terms sold by sales. -->
        <div
          v-for="(option, index) in pricingOptions"
          :key="index"
          class="rounded-default flex flex-col border px-2.5 py-2"
          :class="index === 0 ? 'border-accent' : 'border-border-default'"
          :data-test="`billing-plans-pro-price-option-${index}`"
        >
          <div class="flex min-h-4 items-center gap-2">
            <span class="text-text-secondary text-xs">{{ raw(option.label) }}</span>
            <OTag
              v-if="option.badge"
              variant="success-soft"
              size="xs"
              :label="raw(option.badge)"
              data-test="billing-plans-pro-price-option-badge"
            />
          </div>
          <div class="flex items-baseline gap-1">
            <span class="text-text-heading text-2xl leading-7 font-semibold">
              {{ raw(option.price) }}
            </span>
            <span class="text-text-secondary text-xs">{{ raw(option.period) }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-x-2">
            <span class="text-text-secondary text-xs leading-4">{{ raw(option.note) }}</span>
            <OButton
              v-if="index !== 0"
              variant="ghost-primary"
              size="xs"
              class="ms-auto"
              data-test="billing-plans-pro-contact-sales-btn"
              @click="$emit('contact-sales')"
            >
              {{ t("billing.contactLabel") }}
            </OButton>
          </div>
        </div>
      </div>
    </div>

    <OSeparator />

    <div class="flex-1 px-4 py-3">
      <div
        v-if="pricingError && !features?.length"
        class="text-status-error-text mb-2 flex items-center"
      >
        <OIcon name="warning" size="sm" class="me-2" />
        <span class="text-text-body text-sm leading-5">{{ t("billing.pricingErrorMessage") }}</span>
        <OButton
          variant="ghost"
          size="sm"
          class="ms-2"
          data-test="billing-pricing-retry"
          @click="$emit('retry-pricing')"
        >
          {{ t("common.retry") }}
        </OButton>
      </div>
      <div
        v-for="(feature, index) in features"
        :key="index"
        class="flex items-center justify-between py-0.5"
      >
        <div class="flex items-start">
          <OIcon
            v-if="feature.is_parent"
            name="check-circle"
            size="sm"
            class="text-status-positive check-icon me-2 mt-0.5 shrink-0"
          />
          <div
            class="text-sm leading-5"
            :class="feature.is_parent ? 'text-text-body' : 'text-text-secondary ms-6'"
          >
            {{ feature.name }}
          </div>
        </div>
        <div
          v-if="feature.price !== ''"
          class="border-border-default mx-2 h-0 flex-1 border-t border-dotted opacity-40"
        ></div>
        <div class="text-text-body text-sm leading-5 font-semibold whitespace-nowrap">
          {{ feature.price }}
        </div>
      </div>
    </div>

    <OSeparator />

    <p class="text-text-secondary m-0 px-4 pt-3 text-xs leading-4 font-normal">
      {{ t("billing.unlimitedNote") }}<br />
      {{ t("billing.paymentNote") }}
      <template v-if="additionalInfo">
        <br />
        <span data-test="billing-plans-pro-additional-info">{{ raw(additionalInfo) }}</span>
      </template>
    </p>

    <div class="flex justify-between px-4 pt-2 pb-3">
      <!-- AWS Marketplace billing - show managed externally message -->
      <div v-if="billingProvider === 'aws'" class="w-full text-center">
        <OTag type="billingManagement" value="aws" class="inline-flex items-center gap-1">
          <template #icon>
            <OIcon name="check-circle" size="xs" />
          </template>
        </OTag>
        <div class="text-text-secondary mt-2 text-xs">
          {{ t("billing.awsManagedMessage") }}
        </div>
      </div>
      <div v-else-if="billingProvider === 'azure'" class="w-full text-center">
        <OTag type="billingManagement" value="azure" class="inline-flex items-center gap-1">
          <template #icon>
            <OIcon name="check-circle" size="xs" />
          </template>
        </OTag>
        <div class="text-text-secondary mt-2 text-xs">
          {{ t("billing.azureManagedMessage") }}
        </div>
      </div>
      <!-- External contract - billed offline, no Stripe portal to open -->
      <div v-else-if="subscriptionType === 'external-contract'" class="w-full text-center">
        <OTag type="billingManagement" value="contract" class="inline-flex items-center gap-1">
          <template #icon>
            <OIcon name="description" size="xs" />
          </template>
        </OTag>
        <div class="text-text-secondary mt-2 text-xs">
          {{ t("billing.contractManagedMessage") }}
        </div>
      </div>
      <!-- Stripe billing - show subscribe/manage buttons -->
      <OButton
        v-else-if="planType == planName"
        variant="outline"
        size="sm-action"
        block
        data-test="billing-plans-pro-cancel-btn"
        @click="cancelSubscription"
      >
        {{ btnCancelSubscription }}
      </OButton>
      <OButton
        v-else
        variant="primary"
        size="sm-action"
        block
        data-test="billing-plans-pro-subscribe-btn"
        @click="onSubscribe"
      >
        {{ btnSubscribe }}
      </OButton>
    </div>
  </OCard>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import analytics from "@/services/product_analytics";

export default defineComponent({
  name: "proPlan",
  components: { OSeparator, OButton, OTag, OIcon, OCard },
  props: [
    "planType",
    "billingProvider",
    "subscriptionType",
    "features",
    "pricingOptions",
    "additionalInfo",
    "pricingError",
  ],
  emits: ["retry-pricing", "contact-sales", "update:proSubscription", "update:cancelSubscription"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const planName = "pay-as-you-go";
    const btnCancelSubscription = ref(t("billing.manageSubscription"));
    const btnSubscribe = ref(t("billing.subscribe"));

    const cancelSubscription = () => {
      btnCancelSubscription.value = t("common.loadingEllipsis");
      setTimeout(function () {
        btnCancelSubscription.value = t("billing.manageSubscription");
      }, 1000);
      analytics.track("billing_manage_subscription_clicked", { plan: planName });
      emit("update:cancelSubscription");
    };

    const onSubscribe = () => {
      btnSubscribe.value = t("common.loadingEllipsis");
      setTimeout(function () {
        btnSubscribe.value = t("billing.subscribe");
      }, 1000);
      analytics.track("billing_subscribe_clicked", { plan: planName });
      emit("update:proSubscription");
    };

    return {
      t,
      raw,
      cancelSubscription,
      onSubscribe,
      planName,
      btnSubscribe,
      btnCancelSubscription,
    };
  },
});
</script>
