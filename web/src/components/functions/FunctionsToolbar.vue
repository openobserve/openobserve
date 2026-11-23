<template>
  <!-- The name + transType controls are form-owned (OForm*): AddFunction.vue's <OForm> wraps this
       header so they inject its context, which is what lets the name be the #title. -->
  <OPageHeader
    :subtitle="embedded ? undefined : t('function.addFunction')"
    title-overflow="visible"
    :back="
      embedded
        ? undefined
        : {
            label: t('function.header'),
            onClick: redirectToFunctions,
            dataTest: 'add-function-back-btn',
          }
    "
  >
    <template #title>
      <!-- Embedded (workflow NDV) asks for the name at save time instead. Standalone, Enter saves like
           the panel and alert titles: an unused function has no effect, so an early save is harmless. -->
      <OFormInlineEdit
        v-if="!embedded"
        name="name"
        data-test="add-function-name-input"
        :placeholder="t('function.name')"
        :aria-label="t('function.name')"
        :edit-hint="t('function.renameHint')"
        :readonly="disableName"
        :disabled="disableName"
      />
    </template>
    <template #tabs>
      <div class="o2-input flex h-full items-center gap-4 max-md:h-auto max-md:basis-full">
        <!-- my-2 insets the divider so it runs past the subtitle line rather than stopping at the name. -->
        <OSeparator vertical class="my-2 max-md:hidden" />
        <div class="flex h-9 items-center gap-4">
          <!-- Each option carries its own tip, so both languages can be understood without picking one. -->
          <OFormToggleGroup
            v-if="!hideTransType"
            name="transType"
            type="single"
            data-test="function-transform-type-toggle"
          >
            <OToggleGroupItem value="0" data-test="function-transform-type-vrl-option">
              <template #icon-left>
                <OBadge size="sm" tone="neutral">{{ raw("V") }}</OBadge>
              </template>
              {{ transformTypeOptions[0]?.label }}
              <template #icon-right>
                <OIcon
                  name="info-outline"
                  size="sm"
                  class="cursor-pointer opacity-70"
                  data-test="function-transform-type-vrl-info"
                >
                  <OTooltip>
                    <template #content>
                      <!-- OTooltip lays #content out in a row; one column child keeps the title over the body. -->
                      <div class="flex flex-col">
                        <div class="mb-1 font-semibold">
                          {{ t("function.vrl") }} {{ t("function.tipLabel") }}
                        </div>
                        <div>{{ t("function.vrlFunctionHint") }}</div>
                      </div>
                    </template>
                  </OTooltip>
                </OIcon>
              </template>
            </OToggleGroupItem>

            <OSeparator v-if="transformTypeOptions[1]" vertical class="my-1.5" />

            <!-- A locked JS click is caught here, before the item writes "1" to the form state. -->
            <span
              v-if="transformTypeOptions[1]"
              class="contents"
              @click.capture="
                transformTypeOptions[1]?.disabled ? onLockedJsClick($event) : undefined
              "
            >
              <OToggleGroupItem value="1" data-test="function-transform-type-js-option">
                <template #icon-left>
                  <OBadge size="sm" tone="warn">{{ raw("JS") }}</OBadge>
                </template>
                {{ transformTypeOptions[1]?.label }}
                <template v-if="transformTypeOptions[1]?.disabled" #icon-right>
                  <OIcon
                    name="lock"
                    size="sm"
                    class="lock-chip"
                    data-test="function-transform-type-js-lock"
                  />
                </template>
                <template v-else #icon-right>
                  <OIcon
                    name="info-outline"
                    size="sm"
                    class="cursor-pointer opacity-70"
                    data-test="function-transform-type-js-info"
                  >
                    <OTooltip>
                      <template #content>
                        <div class="flex flex-col">
                          <div class="mb-1 font-semibold">
                            {{ raw("JavaScript") }} {{ t("function.tipLabel") }}
                          </div>
                          <div>{{ t("function.jsFunctionHint") }}</div>
                        </div>
                      </template>
                    </OTooltip>
                  </OIcon>
                </template>
              </OToggleGroupItem>
            </span>
          </OFormToggleGroup>

          <!-- A host that forces one language gets no toggle, so its tip stays reachable here. -->
          <OIcon
            v-else
            name="info-outline"
            size="sm"
            class="text-icon-color shrink-0 cursor-pointer"
            data-test="function-transform-type-info"
          >
            <OTooltip>
              <template #content>
                <div class="flex flex-col">
                  <div class="mb-1 font-semibold">
                    {{ transTypeValue === "1" ? raw("JavaScript") : t("function.vrl") }}
                    {{ t("function.tipLabel") }}
                  </div>
                  <div>
                    {{
                      transTypeValue === "1"
                        ? t("function.jsFunctionHint")
                        : t("function.vrlFunctionHint")
                    }}
                  </div>
                </div>
              </template>
            </OTooltip>
          </OIcon>
        </div>
      </div>
    </template>
    <template #actions>
      <OButton
        v-if="
          config.isEnterprise == 'true' &&
          !isAddFunctionComponent &&
          store.state.zoConfig.ai_enabled &&
          !hideChat
        "
        icon-only
        variant="ghost"
        @click="emit('open:chat', !store.state.isAiChatEnabled)"
        data-test="menu-link-ai-item"
        :aria-label="t('menu.aiAssistant')"
        class="rounded-default hover:shadow-ai-accent/35 transition-[background,box-shadow] duration-300 ease-in-out ![background:var(--color-gradient-ai-subtle)] hover:shadow-md hover:![background:var(--color-gradient-ai)]"
        :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
        :disabled="isSubmitting"
        @mouseenter="isHovered = true"
        @mouseleave="isHovered = false"
      >
        <img
          alt=""
          :src="getBtnLogo"
          class="opacity-70 transition-transform duration-600 [.ai-btn-active_&]:!opacity-100"
        />
      </OButton>
      <OButton
        v-if="!embedded"
        data-test="add-function-fullscreen-btn"
        v-close-popup="true"
        variant="secondary"
        :disabled="isSubmitting"
        @click="handleFullScreen"
        icon="fullscreen"
      >
        {{ t("common.fullscreen") }}
      </OButton>
      <OButton
        v-if="!hideTest"
        data-test="add-function-test-btn"
        variant="secondary"
        :disabled="isSubmitting"
        @click="emit('test')"
        icon="play-arrow"
      >
        {{ t("function.testFunction") }}
      </OButton>
      <OButton
        v-if="!embedded"
        data-test="add-function-cancel-btn"
        variant="secondary"
        :disabled="isSubmitting"
        @click="emit('cancel')"
      >
        {{ t("function.cancel") }}
      </OButton>
      <OButton
        data-test="add-function-save-btn"
        variant="primary"
        type="submit"
        :loading="isSubmitting"
      >
        {{ t("function.save") }}
      </OButton>
    </template>
  </OPageHeader>
</template>
<script setup lang="ts">
import { ref, computed, type PropType, inject } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import config from "../../aws-exports";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFormInlineEdit from "@/lib/forms/InlineEdit/OFormInlineEdit.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import { toggleFullscreen } from "@/utils/dom";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";
const { t } = useI18nTyped();

const router = useRouter();

const store = useStore();
const { isDark } = useTheme();
const { open: openUpgradeDialog } = useEnterpriseUpgradeDialog();

function onLockedJsClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  openUpgradeDialog();
}

defineProps({
  disableName: {
    type: Boolean,
    default: false,
  },
  transformTypeOptions: {
    type: Array as PropType<{ label: string; value: string | number; disabled?: boolean }[]>,
    default: () => [],
  },
  // Hides the VRL/JS language toggle entirely (used when a host forces a single
  // language — e.g. workflow function nodes are JavaScript-only).
  hideTransType: {
    type: Boolean,
    default: false,
  },
  // Hides the top "Ask AI" chat toggle (workflows keep only the inline editor AI).
  hideChat: {
    type: Boolean,
    default: false,
  },
  // Hides the "Test Function" action (workflows test via the NDV's Replay instead of
  // the embedded test panel, which is removed there).
  hideTest: {
    type: Boolean,
    default: false,
  },
  // Embedded in a host panel (workflow NDV): the host owns title, close and navigation,
  // so the back link, subtitle, Go Full Screen and Cancel are dropped.
  embedded: {
    type: Boolean,
    default: false,
  },
  /** Drives the Save spinner + disables sibling actions while the form submits. */
  isSubmitting: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["test", "back", "cancel", "open:chat"]);

const isHovered = ref(false);

// The name + transType fields are form-owned (OForm*). We only READ transType
// here (for the forced-language info tooltip) via the injected OForm context.
const form = inject(FORM_CONTEXT_KEY, null);
const transTypeValue = form
  ? form.useStore((s: any) => String(s.values.transType ?? "0"))
  : ref("0");

const isAddFunctionComponent = computed(() => router.currentRoute.value.path.includes("functions"));
const handleFullScreen = () => {
  toggleFullscreen();
};

const redirectToFunctions = () => {
  emit("back");
};

const getBtnLogo = computed(() => {
  if (isHovered.value || store.state.isAiChatEnabled) {
    return getImageURL("images/common/ai_icon_dark.svg");
  }

  return isDark.value
    ? getImageURL("images/common/ai_icon_dark.svg")
    : getImageURL("images/common/ai_icon_gradient.svg");
});
</script>
