<template>
<div class="flex h-screen">
  <!-- Left Banner Section -->
  <div class="hidden lg:flex lg:w-[40%] bg-[url('@/assets/images/common/openobserve_banner_compreesed.png')] bg-cover bg-center bg-no-repeat">

    <div style="display: flex; justify-content: start; align-items: end; height: 100%;">
    <div style="margin-bottom: 34px; margin-left: 32px;">
     <span style=" margin-bottom: 12px;"> <img style="height: 40px; margin-left: -1px;" src="@/assets/images/common/openobserve_logo_light.svg" alt="OpenObserve Logo" />
      </span>
      <div style="font-size: 24px; color: white; font-weight: 600; line-height:33px; margin-top: 5px; ">
        Try OpenObserve today for more efficient and performant observability.
      </div>
    </div>
  </div>
  </div>

  <!-- Right Form Section -->
  <div :class="[
    store.state.theme == 'dark' ? 'bg-black' : 'bg-white'
  ]" class="w-full lg:w-[60%]  h-full flex flex-col justify-center items-center relative">

    <!-- Top Section: Logo and Heading -->
    <div class="flex flex-col items-center mb-4">
      <img style="height: 64px;" src="@/assets/images/common/o2_logo.svg" alt="Get Started Banner" />
      <div class="text-[24px] md:text-[32px] font-semibold  text-center"
      :class="[
        store.state.theme == 'dark' ? 'text-[#ffffff]' : 'text-[#525252]'
      ]"
      >
        One last thing before we begin
      </div>
    </div>

    <!-- Form Section -->
<!-- Form Section -->
<div class="w-full flex justify-center">
  <div class="w-full max-w-[500px] flex flex-col items-center gap-y-2 px-4">
    <OForm ref="formRef" :schema="getStartedSchema" :default-values="getStartedDefaults()" @submit="doSubmit" v-slot="{ isSubmitting }" class="w-full flex flex-col gap-y-2">
    <OFormInput
      name="hearAboutUs"
      data-test="onboarding-get-started-hear-about-us"
      class="o2-input"
      label="How did you hear about us?"
      required
      placeholder="Eg. From a friend"
      style="width: 100%;"
    />
    <OFormInput
      name="whereDoYouWork"
      data-test="onboarding-get-started-where-do-you-work"
      class="-mt-2"
      label="Where do you work?"
      required
      placeholder="Company Name"
      style="width: 100%;"
    />
    <div class="w-full">
      <OFormCheckbox name="isAgree" data-test="onboarding-get-started-agree-checkbox">
        <template #label>
          <span class="text-sm">
            I have read and agree with the
            <a href="#" class="text-[#6B76E3] hover:underline">Terms of use</a> and
            <a href="#" class="text-[#6B76E3] hover:underline">Privacy policy*</a>
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
        Start your 14-day Trial
      </OButton>
    </div>
    </OForm>
  </div>
</div>


    <!-- Footer -->
    <div class="absolute bottom-5 text-sm mb-[16px]"
    :class="[
      store.state.theme == 'dark' ? 'text-[#ffffff]' : 'text-[#767676]'
    ]"
    >
      &copy; OpenObserve <span id="year">{{ new Date().getFullYear() }}</span>
    </div>
  </div>
</div>

</template>

<script setup>
import { ref } from 'vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OForm from '@/lib/forms/Form/OForm.vue'
import OFormInput from '@/lib/forms/Input/OFormInput.vue'
import OFormCheckbox from '@/lib/forms/Checkbox/OFormCheckbox.vue'
import { getStartedSchema, getStartedDefaults } from './GetStarted.schema'
import { useStore } from 'vuex'
  import billings from '@/services/billings'
import { toast } from "@/lib/feedback/Toast/useToast";
const store = useStore()
const emit = defineEmits(['removeFirstTimeLogin'])
const formRef = ref(null);

const doSubmit = async (value) => {
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
