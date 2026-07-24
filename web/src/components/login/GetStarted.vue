<template>
<div class="flex h-screen">
  <!-- Left Banner Section -->
  <div class="hidden lg:flex lg:w-[40%] bg-[url('@/assets/images/common/openobserve_banner_compreesed.png')] bg-cover bg-center bg-no-repeat">

    <div class="flex justify-start items-end h-full">
    <div class="mb-8.5 ml-8">
     <span class="mb-3"> <img class="h-10 -ml-px" src="@/assets/images/common/openobserve_logo_light.svg" :alt="t('login.openObserveLogoAlt')" />
      </span>
      <div class="text-2xl font-semibold text-text-inverse leading-8.25 mt-1.25">
        {{ t('login.getStartedBannerMessage') }}
      </div>
    </div>
  </div>
  </div>

  <!-- Right Form Section -->
  <div class="bg-surface-base w-full lg:w-[60%] h-full flex flex-col justify-center items-center relative">

    <!-- Top Section: Logo and Heading -->
    <div class="flex flex-col items-center mb-4">
      <img class="h-16" src="@/assets/images/common/o2_logo.svg" :alt="t('login.getStartedBannerAlt')" />
      <div class="text-2xl md:text-3xl font-semibold text-center text-text-heading">
        {{ t('login.getStartedHeading') }}
      </div>
    </div>

    <!-- Form Section -->
<!-- Form Section -->
<div class="w-full flex justify-center">
  <div class="w-full max-w-125 flex flex-col items-center gap-y-2 px-4">
    <OForm ref="formRef" :schema="getStartedSchema" :default-values="getStartedDefaults()" @submit="doSubmit" v-slot="{ isSubmitting }" class="w-full flex flex-col gap-y-2">
    <OFormInput
      name="hearAboutUs"
      data-test="onboarding-get-started-hear-about-us"
      class="o2-input w-full"
      :label="t('login.hearAboutUsLabel')"
      required
      :placeholder="t('login.hearAboutUsPlaceholder')"
    />
    <OFormInput
      name="whereDoYouWork"
      data-test="onboarding-get-started-where-do-you-work"
      class="-mt-2 w-full"
      :label="t('login.whereDoYouWorkLabel')"
      required
      :placeholder="t('login.whereDoYouWorkPlaceholder')"
    />
    <div class="w-full">
      <OFormCheckbox name="isAgree" data-test="onboarding-get-started-agree-checkbox">
        <template #label>
          <span class="text-sm">
            {{ t('login.agreeToTermsPrefix') }}
            <a href="#" class="text-text-link hover:underline">{{ t('login.termsOfUse') }}</a> {{ t('login.and') }}
            <a href="#" class="text-text-link hover:underline">{{ t('login.privacyPolicyStar') }}</a>
          </span>
        </template>
      </OFormCheckbox>
    </div>
    <div class="w-full mt-4">
      <OButton
        data-test="onboarding-get-started-submit-btn"
        variant="primary"
        size="md"
        block
        :disabled="isSubmitting"
        :loading="isSubmitting"
        type="submit"
      >
        {{ t('login.startTrialButton') }}
      </OButton>
    </div>
    </OForm>
  </div>
</div>


    <!-- Footer -->
    <div class="absolute bottom-5 text-sm mb-4 text-text-secondary">
      {{ t('login.copyrightNotice') }} <span id="year">{{ new Date().getFullYear() }}</span>
    </div>
  </div>
</div>

</template>

<script setup lang="ts">
import { ref } from 'vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OForm from '@/lib/forms/Form/OForm.vue'
import OFormInput from '@/lib/forms/Input/OFormInput.vue'
import OFormCheckbox from '@/lib/forms/Checkbox/OFormCheckbox.vue'
import { getStartedSchema, getStartedDefaults, type GetStartedForm } from './GetStarted.schema'
import { useStore } from 'vuex'
  import billings from '@/services/billings'
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18n } from "vue-i18n";
const store = useStore()
const { t } = useI18n();
const emit = defineEmits(['removeFirstTimeLogin'])
const formRef = ref(null);

const doSubmit = async (value: GetStartedForm) => {
  const res = await billings.submit_new_user_info(store.state.selectedOrganization.identifier, {
    from: value.hearAboutUs,
    company: value.whereDoYouWork,
  })
  if(res.status == 200) {
    localStorage.removeItem("isFirstTimeLogin");
    emit("removeFirstTimeLogin",false);
    // Notify first-login follow-ups (e.g. the community Slack invite) that the
    // onboarding form is done, so they don't stack on top of this full-screen dialog.
    window.dispatchEvent(new CustomEvent("o2:onboarding-complete"));
    toast({
      message: 'Thank you for your feedback',
      variant: 'success',
    })
  } else {
    toast({
      message: 'Something went wrong',
      variant: 'error',
    })
  }
}
</script>
