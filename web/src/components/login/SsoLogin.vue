<template>
  <div style="max-width: 400px; margin-top: 100px" class="mx-auto p-3">
    <div class="flex justify-center" style="height: 150px">
      <img
        class="appLogo"
        style="width: 250px; height: auto"
        :src="
          store.state.theme == 'dark'
            ? getImageURL('images/common/openobserve_latest_dark_2.svg')
            : getImageURL('images/common/openobserve_latest_light_2.svg')
        "
      />
    </div>

    <div class="flex justify-center mt-4">
      <OButton
        data-test="sso-login-btn"
        variant="primary"
        size="sm-action"
        style="width: 400px"
      >
        <div
          data-test="sso-login-btn"
          class="flex items-center justify-center w-full text-center relative"
        >
          <img
            class="absolute"
            style="width: 30px; left: 16px"
            :src="getImageURL('images/common/sso.svg')"
          />
          <span class="text-center"> Login with SSO</span>
        </div>
      </OButton>
    </div>

    <div class="mb-3 mt-4 text-center">
      <a
        data-test="sso-login-internal-link"
        class="cursor-pointer hover:text-[#595959]"
        style="text-decoration: underline"
        @click="showLoginInput = !showLoginInput"
        >Sign in with an internal user</a
      >

      <div v-show="showLoginInput" class="o2-input pt-4">
        <div class="gap-3">
          <OInput
            v-model="name"
            data-cy="login-user-id"
            data-test="login-user-id"
            :label="`${t('login.userEmail')} *`"
            placeholder="Email"
            type="email"
          />

          <OInput
            v-model="password"
            data-cy="login-password"
            data-test="login-password"
            :label="`${t('login.password')} *`"
            placeholder="Password"
            type="password"
          />

          <div class="mt-4 mb-6">
            <OButton
              data-cy="login-sign-in"
              variant="primary"
              size="sm-action"
              block
              type="submit"
              :loading="isSubmitting"
              @click="onSignIn()"
            >
              {{ t('login.signIn') }}
            </OButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OButton from '@/lib/core/Button/OButton.vue';
import OInput from '@/lib/forms/Input/OInput.vue';

const store = useStore();

const { t } = useI18n();

const name = ref("");
const password = ref("");

const isSubmitting = ref(false);

const showLoginInput = ref(false);

const onSignIn = () => {
  console.log("onSignIn");
};
</script>
