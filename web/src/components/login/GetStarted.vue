<template>
<div class="tw:flex tw:h-screen">
  <!-- Left Banner Section -->
  <div class="tw:hidden lg:tw:flex lg:tw:w-[40%] login_banner_container">

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
    store.state.theme == 'dark' ? 'tw:bg-black' : 'tw:bg-white'
  ]" class="tw:w-full lg:tw:w-[60%]  tw:h-full tw:flex tw:flex-col tw:justify-center tw:items-center tw:relative">

    <!-- Top Section: Logo and Heading -->
    <div class="tw:flex tw:flex-col tw:items-center tw:mb-4">
      <img style="height: 64px;" src="@/assets/images/common/o2_logo.svg" alt="Get Started Banner" />
      <div class="tw:text-[24px] md:tw:text-[32px] tw:font-semibold  tw:text-center" 
      :class="[
        store.state.theme == 'dark' ? 'tw:text-[#ffffff]' : 'tw:text-[#525252]'
      ]"
      >
        One last thing before we begin
      </div>
    </div>

    <!-- Form Section -->
<!-- Form Section -->
<div class="tw:w-full tw:flex tw:justify-center">
  <div class="tw:w-full tw:max-w-[500px] tw:flex tw:flex-col tw:items-center tw:gap-y-2 tw:px-4">
    <q-input
      class="showLabelOnTop no-case input-field o2-input"
      v-model="hearAboutUs"
      outlined
      :label="`How did you hear about us? *`"
      placeholder="Eg. From a friend"
      dense
      stack-label
      filled
      color="primary"
      style="width: 100%;"
      required
      :rules="[(val) => val.length > 0 || 'This field is required']"
    />
    <q-input
      class="showLabelOnTop no-case -tw:mt-2"
      v-model="whereDoYouWork"
      outlined
      :label="`Where do you work? *`"
      placeholder="Company Name"
      dense
      stack-label
      filled
      style="width: 100%;"
      required
      :rules="[(val) => val.length > 0 || 'This field is required']"
    />
    <div class="tw:w-full tw:flex tw:items-center tw:ml-[-18px]">
      <q-checkbox v-model="isAgree" class="tw:items-center">
        <span class="tw:text-sm">
          I have read and agree with the
          <a href="#" class="tw:text-[#6B76E3] hover:underline">Terms of use</a> and
          <a href="#" class="tw:text-[#6B76E3] hover:underline">Privacy policy*</a>
        </span>
      </q-checkbox>
    </div>
    <q-btn
      :disable="!isAgree || isSubmitting"
      class="tw:w-full tw:h-[40px] tw:bg-[#6B76E3] tw:text-white tw:font-semibold  tw:mt-4"
      label="Start your 14-day Trial"
      no-caps
      :loading="isSubmitting"
      @click="onSubmit"
    />
  </div>
</div>


    <!-- Footer -->
    <div class="tw:absolute tw:bottom-5 tw:text-sm tw:mb-[16px]" 
    :class="[
      store.state.theme == 'dark' ? 'tw:text-[#ffffff]' : 'tw:text-[#767676]'
    ]"
    >
      &copy; OpenObserve <span id="year">{{ new Date().getFullYear() }}</span>
    </div>
  </div>
</div>

</template>

<script setup>
import { ref } from 'vue'
import { useStore } from 'vuex'
import { useQuasar } from 'quasar'
  import billings from '@/services/billings'
const hearAboutUs = ref('')
const whereDoYouWork = ref('')
const isAgree = ref(false)
const store = useStore()
const emit = defineEmits(['removeFirstTimeLogin'])
const $q = useQuasar();
const isSubmitting = ref(false);

const validateForm = () => {
  if(!hearAboutUs.value.trim() || !whereDoYouWork.value.trim()) {
    return false
  }
  return true
}
const onSubmit = async () => {

  isSubmitting.value = true
  if(!validateForm()) {
    $q.notify({
      message: 'Please fill all the fields',
      color: 'negative',
    })
    isSubmitting.value = false
    return
  }

  const res = await billings.submit_new_user_info(store.state.selectedOrganization.identifier, {
    from: hearAboutUs.value,
    company: whereDoYouWork.value,
  })
  if(res.status == 200) {
    localStorage.removeItem("isFirstTimeLogin");
    emit("removeFirstTimeLogin",false);
    $q.notify({
      message: 'Thank you for your feedback',
      color: 'positive',
    })
    isSubmitting.value = false
  } else {
    $q.notify({
      message: 'Something went wrong',
      color: 'negative',
    })
    isSubmitting.value = false
  }
}
</script>

<style lang="scss">
.login_banner_container {
  background-image: url('@/assets/images/common/openobserve_banner_compreesed.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}
</style>

<style lang="scss" scoped>

</style>
