<template>
  <!-- Standard app header: back tile + the function NAME as the title (inline-
       edited in place, so it is not a boxed field wedged into the toolbar), the
       mode as the subtitle, the language toggle inline (#tabs) and the
       action buttons (#actions). The name + transType controls are form-owned
       (OForm*); the parent AddFunction.vue provides the <OForm> context they
       inject — which is what lets the title live in the #title slot. -->
  <OPageHeader
    :subtitle="t('function.addFunction')"
    title-overflow="visible"
    :back="{
      label: t('function.header'),
      onClick: redirectToFunctions,
      dataTest: 'add-function-back-btn',
    }"
  >
    <template #title>
      <OFormInlineEdit
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
      <div class="o2-input flex h-full items-center gap-4">
        <!-- Divider between the function name (header #title) and the language
             toggle — they are separate controls sharing one header row. h-full +
             the separator's own self-stretch span the full h-15 header row; my-2
             insets it to ~2.75rem, so it runs past the subtitle line ("Add
             Function") rather than stopping at the name. -->
        <OSeparator vertical class="my-2" />
        <!-- Transform-type (language) selector -->
        <div class="flex h-9 items-center gap-4">
          <!-- A segmented toggle rather than a radio group: the two languages are
               mutually exclusive VIEWS of the same editor, so they read as a
               switch. Each option carries its OWN info tip, so both languages can
               be understood WITHOUT selecting one first (the previous single tip
               only ever described the already-selected language).
               Hidden entirely when a host forces a single language (e.g. workflow
               function nodes are JS-only) — the locked language's tip moves to the
               standalone icon below. -->
          <OFormToggleGroup
            v-if="!hideTransType"
            name="transType"
            type="single"
            data-test="function-transform-type-toggle"
          >
            <OToggleGroupItem value="0" data-test="function-transform-type-vrl-option">
              <template #icon-left>
                <!-- Language mark. Colours match the transType column badge in
                     FunctionList so VRL/JS read the same everywhere. -->
                <OBadge size="xs" shape="rounded" variant="blue-soft">{{ raw("V") }}</OBadge>
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
                      <!-- Wrap in one column container: OTooltip renders the
                           #content slot inside an inline-flex row, so sibling
                           blocks would sit side-by-side. A single flex-col child
                           keeps title over body. -->
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

            <!-- Pipe divider between the two options -->
            <OSeparator v-if="transformTypeOptions[1]" vertical class="my-1.5" />

            <!-- JavaScript option only shown in _meta organization -->
            <OToggleGroupItem
              v-if="transformTypeOptions[1]"
              value="1"
              data-test="function-transform-type-js-option"
            >
              <template #icon-left>
                <OBadge size="xs" shape="rounded" variant="amber-soft">{{ raw("JS") }}</OBadge>
              </template>
              {{ transformTypeOptions[1]?.label }}
              <template #icon-right>
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
          </OFormToggleGroup>

          <!-- Forced-language hosts get no toggle, so the tip for the locked
               language stays reachable here. -->
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
          store.state.zoConfig.ai_enabled
        "
        variant="ghost"
        size="icon-sm"
        @click="emit('open:chat', !store.state.isAiChatEnabled)"
        data-test="menu-link-ai-item"
        class="rounded-default hover:shadow-ai-accent/35 transition-[background,box-shadow] duration-300 ease-in-out ![background:var(--color-gradient-ai-subtle)] hover:shadow-md hover:![background:var(--color-gradient-ai)]"
        :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
        :disabled="isSubmitting"
        @mouseenter="isHovered = true"
        @mouseleave="isHovered = false"
      >
        <img
          :src="getBtnLogo"
          class="opacity-70 transition-transform duration-600 [.ai-btn-active_&]:!opacity-100"
        />
      </OButton>
      <OButton
        data-test="add-function-fullscreen-btn"
        v-close-popup="true"
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="handleFullScreen"
        icon-left="fullscreen"
      >
        {{ t("common.fullscreen") }}
      </OButton>
      <OButton
        data-test="add-function-test-btn"
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="emit('test')"
        icon-left="play-arrow"
      >
        {{ t("function.testFunction") }}
      </OButton>
      <OButton
        data-test="add-function-cancel-btn"
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="emit('cancel')"
      >
        {{ t("function.cancel") }}
      </OButton>
      <OButton
        data-test="add-function-save-btn"
        variant="primary"
        size="sm-action"
        type="submit"
        :loading="isSubmitting"
      >
        {{ t("function.save") }}
      </OButton>
    </template>
  </OPageHeader>
</template>
<script setup lang="ts">
import { ref, computed, type PropType } from "vue";
import { inject } from "vue";
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
const { t } = useI18nTyped();

const router = useRouter();

const store = useStore();
const { isDark } = useTheme();

defineProps({
  disableName: {
    type: Boolean,
    default: false,
  },
  transformTypeOptions: {
    type: Array as PropType<{ label: string; value: string | number }[]>,
    default: () => [],
  },
  // Hides the VRL/JS language toggle entirely (used when a host forces a single
  // language — e.g. workflow function nodes are JavaScript-only).
  hideTransType: {
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
