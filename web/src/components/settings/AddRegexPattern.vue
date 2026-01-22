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
<!-- TODO: Remove store.state.theme based styling as we moved towards having at central place that is app.scss so we plan this whole to that place -->
<template>
    <div
      class="q-pt-md"
      :class="[store.state.theme === 'dark' ? 'bg-dark add-regex-pattern-dark' : 'bg-white add-regex-pattern-light',
      ]"
          :style="{
            width: isFullScreen  ? '100vw' : store.state.isAiChatEnabled ? '70vw' : '40vw'
            }"
    >
      <div class="add-regex-pattern-header q-px-md tw:flex tw:items-center tw:justify-between">
        <div class="tw:flex tw:items-center tw:justify-between">
                <q-btn
                    data-test="add-regex-pattern-back-btn"
                    @click="closeAddRegexPatternDialog"
                    round
                    flat
                    icon="arrow_back"
                />
          <div class="add-regex-pattern-title" data-test="add-regex-pattern-title">
            {{ isEdit ? t("regex_patterns.edit_regex_pattern") : t("regex_patterns.create_regex_pattern") }}
          </div>
        </div>
        <div class="tw:flex tw:items-center tw:justify-between tw:gap-2">
            <q-btn
            v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
            :ripple="false"
            @click="toggleAIChat"
            data-test="add-regex-pattern-open-close-ai-btn"
            no-caps
            :borderless="true"
            flat
            dense
            class="o2-button ai-hover-btn q-px-sm q-py-sm"
            :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
            style="border-radius: 100%;"
            @mouseenter="isHovered = true"
            @mouseleave="isHovered = false"
            >
            <div class="row items-center no-wrap tw:gap-2  ">
                <img  :src="getBtnLogo" class="header-icon ai-icon" />
            </div>
            </q-btn>
            <q-btn 
            data-test="add-regex-pattern-fullscreen-btn"
            icon="fullscreen" 
            size="14px" 
            dense 
            class="tw:cursor-pointer" 
            :class="store.state.theme === 'dark' ? 'tw:text-white' : ''"
            :color="isFullScreen ? 'primary' : undefined"
            @click="toggleFullScreen"
          />
          <q-btn
            data-test="add-regex-pattern-close-btn"
            @click="closeAddRegexPatternDialog"
            round
            flat
            icon="cancel"
        />
        </div>

      </div>
      <q-separator class="q-mb-md q-mt-sm" />
      <!-- form inputs starts here -->
       <div class="tw:flex tw:w-[100%]">
            <div
            :class="store.state.isAiChatEnabled ? isFullScreen ? 'tw:w-[75%] q-pl-sm' : 'tw:w-[65%] q-pl-sm' : 'tw:w-[100%] q-px-md'"
            >
            <q-form @submit="saveRegexPattern" class="tw:flex tw:flex-col tw:gap-4" style="overflow: auto; height: calc(100vh - 150px);">
                <div class="tw:flex tw:flex-col">
                    <q-input
                        v-bind:readonly="isEdit"
                        v-bind:disable="isEdit"
                        v-model="regexPatternInputs.name"
                        :label="t('regex_patterns.name') + ' *'"
                        class="showLabelOnTop"
                        data-test="add-regex-pattern-name-input"
                        stack-label
                        dense
                        borderless
                        :lazy-rules="true"
                        :hide-bottom-space="true"
                        :rules="[val => val !== '' || '* Name is required']"
                        placeholder="Eg. Internal Passwords"
                        />
                    <q-input
                        v-bind:readonly="isEdit"
                        v-bind:disable="isEdit"
                        v-model="regexPatternInputs.description"
                        :label="t('regex_patterns.description')"
                        class="q-pb-md showLabelOnTop"
                        stack-label
                        borderless
                        :hide-bottom-space="true"
                        dense
                        data-test="add-regex-pattern-description-input"
                        placeholder="Describe your pattern to help users understand"
                        />
                <div class="regex-pattern-input-container">
                    <div class="tw:flex tw:items-center tw:justify-between">
                        <span class="regex-pattern-input-label">
                            Regex Pattern
                        </span>
                        <q-btn v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
                         class="tw:px-2 tw:py-1 tw:flex tw:items-center"
                        style="border-radius: 4px;" dense no-caps flat  @click="toggleAIChat">
                        <img :src="goToAILogo" class="tw:w-[20px] tw:h-[20px] tw:mr-1" />
                        <span class="tw:text-[#5960B2] tw:text-sm tw:flex tw:items-center tw:gap-1">
                            Try O2 Assistant to write expressions 
                        </span>
                        <q-icon size="sm" name="arrow_right_alt" class="tw:text-[#5960B2] tw:w-[20px] tw:h-[20px] tw:ml-1" />

                            </q-btn>
                    </div>
                    <div class="regex-pattern-input">
                        <div
                            class="tw:py-[2px] tw:h-[24px]"
                            :class="store.state.theme === 'dark' ? 'tw:bg-gray-500' : 'tw:bg-gray-200 '"
                        >
                                <div
                                class="tw:text-[12px] tw:font-[500] tw:px-2"
                                :class="[
                                    store.state.theme === 'dark'
                                    ? 'tw:text-[#ffffff]'
                                    : 'tw:text-[#6B7280]',
                                ]"
                                >
                                Write Pattern
                                </div>    
                        </div>
                            <q-input
                            data-test="add-regex-pattern-input"
                            v-model="regexPatternInputs.pattern"
                            class="regex-pattern-input"
                            :class="store.state.theme === 'dark' ? 'dark-mode-regex-pattern-input' : 'light-mode-regex-pattern-input'"
                            stack-label
                            borderless
                            dense
                            tabindex="0"
                            style="width: 100%; resize: none;"
                            type="textarea"
                            placeholder="Eg. \d....\d "
                            rows="5"
                            :rules="[val => val !== '' || '* Pattern is required']"
                            :hide-bottom-space="true"
                        />
                    </div>
                </div>
                <q-separator class="tw:my-2" />
                <div>
                    <div class="tw:flex tw:items-center tw:justify-between">
                        <span class="regex-pattern-test-string-label">
                            Test Regex Pattern
                        </span>
                        <div class="tw:h-[19px] tw:flex tw:items-center tw:justify-center tw:font-[600]" style="border-radius: 3px;">
                            <q-btn :disable="regexPatternInputs.pattern.length === 0" class="tw:px-2 tw:bg-[#5960B2] tw:text-[12px] tw:text-white tw:min-h-[19px] tw:h-[19px] tw:flex tw:items-center tw:justify-center"
                        style="border-radius: 3px;" flat dense no-caps borderless  @click="testStringOutput">
                        <span>
                            Test Input
                        </span>
                    </q-btn>
                        </div>
                    </div>
                </div>
                <div class="regex-pattern-test-string-container q-mb-sm">
                    <FullViewContainer
                        name="query"
                        v-model:is-expanded="expandState.regexTestString"
                        label="Input string"
                        class="tw:mt-1 tw:py-md tw:h-[24px]"
                        :labelClass="store.state.theme === 'dark' ? 'dark-test-string-container-label' : 'light-test-string-container-label'"
                    >
                    <template #right>

                    </template>
                </FullViewContainer>
                    <div v-if="expandState.regexTestString" class="regex-pattern-input" >
                        <q-input
                        data-test="add-regex-test-string-input"
                        v-model="testString"
                        color="input-border"
                        bg-color="input-bg"
                        class="regex-test-string-input"
                        :class="store.state.theme === 'dark' ? 'dark-mode-regex-test-string-input' : 'light-mode-regex-test-string-input'"
                        stack-label
                        borderless
                        dense
                        tabindex="0"
                        style="width: 100%; resize: none;"
                        type="textarea"
                        placeholder="Eg. 1234567890"
                        rows="5"
                        />
                    </div>
                </div>
                <div class="regex-pattern-test-string-container">
                    <FullViewContainer
                        name="output"
                        v-model:is-expanded="expandState.outputString"
                        label="Output"
                        class="tw:mt-1 tw:py-md tw:h-[24px]"
                        :labelClass="store.state.theme === 'dark' ? 'dark-test-string-container-label' : 'light-test-string-container-label'"
                    >
                </FullViewContainer>
                    <div v-if="expandState.outputString" class="regex-pattern-input" >
                        <q-input
                        v-if="outputString.length > 0"
                        data-test="add-regex-test-string-input"
                        v-model="outputString"
                        color="input-border"
                        bg-color="input-bg"
                        class="regex-test-string-input"
                        :class="store.state.theme === 'dark' ? 'dark-mode-regex-test-string-input' : 'light-mode-regex-test-string-input'"
                        stack-label
                        outlined
                        filled
                        dense
                        tabindex="0"
                        style="width: 100%; resize: none;"
                        type="textarea"
                        placeholder="Output String"
                        rows="5"
                        />
                        <div v-else class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-[111px] " 
                        :class="store.state.theme === 'dark' ? 'dark-mode-regex-no-output' : 'light-mode-regex-no-output'"

                        >
                            <div v-if="!testLoading && outputString.length === 0">
                                <q-icon :name="outlinedLightbulb" size="24px" :class="store.state.theme === 'dark' ? 'tw:text-[#ffffff]' : 'tw:text-[#A8A8A8]'" />
                            <span class="tw:text-[12px] tw:font-[400] tw:text-center" :class="store.state.theme === 'dark' ? 'tw:text-[#ffffff]' : 'tw:text-[#4B5563]'">
                                Please click Test Input to see the results
                            </span>
                            </div>
                            <div v-else-if="testLoading">
                                <span class="tw:flex tw:items-center tw:justify-center tw:h-[111px]">
                                    <q-spinner-hourglass color="primary" size="24px" />
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                </div>

            </q-form>
            <div class="flex justify-end q-mt-sm" style="position: sticky; bottom: 0; right: 0;">
                <q-btn
                    v-close-popup
                    class="q-mr-md o2-secondary-button tw:h-[36px]"
                    :label="t('regex_patterns.cancel')"
                    no-caps
                    flat
                    :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                    data-test="add-regex-pattern-cancel-btn"
                />
                <q-btn
                    class="o2-primary-button no-border tw:h-[36px]"
                    :label="isSaving ? 'Saving...' : isEdit ? t('regex_patterns.update_close') : t('regex_patterns.create_close')"
                    type="submit"
                    no-caps
                    flat
                    :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
                    @click="saveRegexPattern"
                    :disable="isFormEmpty || isSaving"
                    data-test="add-regex-pattern-save-btn"
                />
            </div>
            </div>
            <div  class="q-ml-sm" v-if="store.state.isAiChatEnabled " style="width:35%; max-width: 100%; min-width: 75px; height: calc(100vh - 90px) !important;  " :class="store.state.theme == 'dark' ? 'dark-mode-chat-container' : 'light-mode-chat-container'" >
                <O2AIChat :aiChatInputContext="inputContext" style="height: calc(100vh - 90px) !important;" :is-open="store.state.isAiChatEnabled" @close="store.state.isAiChatEnabled = false" />
            </div>
       </div>

    </div>
    
  </template>
  
<script lang="ts">
import { defineComponent, onMounted, ref, watch, nextTick, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import type { Ref } from "vue";
import { useStore } from "vuex";
import { computed } from "vue";
import { debounce, useQuasar } from "quasar";
import useStreams from "@/composables/useStreams";
import config from "@/aws-exports";
import { getImageURL } from "@/utils/zincutils";
import FullViewContainer from "../functions/FullViewContainer.vue";
import regexPatternService from "@/services/regex_pattern";
import O2AIChat from "@/components/O2AIChat.vue";
import { useRouter } from "vue-router";
import { outlinedLightbulb } from "@quasar/extras/material-icons-outlined";

export default defineComponent({
    name: "AddRegexPattern",
    props: {
        data: {
            type: Object,
            default: () => ({}),
        },
        isEdit: {
            type: Boolean,
            default: false,
        },
    },
    emit: ["close", "update:list"],
    components: {
        FullViewContainer,
        O2AIChat
    },
setup(props, {emit}) {
    const { t } = useI18n();

    const store = useStore();

    const q = useQuasar();

    const isHovered = ref(false);

    const isFullScreen = ref(false);

    const router = useRouter();


    const testString = ref("");

    const isFormEmpty = ref(props.isEdit ? false : true);

    const testLoading = ref(false);

    const isPatternValid = ref(false);

    const queryEditorRef = ref<any>(null);

    const isSaving = ref(false);

    const outputString = ref("");

    const inputContext = ref("");

    const regexPatternInputs: any = ref({
        name: "",
        pattern: "",
        description: "",//this is optional we dont consider it anyway but it is should go in the payload with atleast empty string if user doesnot provide it
    });

    const expandState = ref({
        regexPattern: true,
        regexTestString: true,
        outputString: false,
    });


    onMounted(()=>{
        if(props.isEdit){
            regexPatternInputs.value.name = props.data.name;
            regexPatternInputs.value.pattern = props.data.pattern;
            regexPatternInputs.value.description = props.data.description ? props.data.description : "";
        }
        else{
            regexPatternInputs.value = {
                name: "",
                pattern: "",
                description: ""
            }
        }
        if(store.state.organizationData.regexPatternPrompt && router.currentRoute.value.query.from == 'logs'){
            inputContext.value = store.state.organizationData.regexPatternPrompt;
            testString.value = store.state.organizationData.regexPatternTestValue;
        }
    })


    // Form validation watcher
    watch([() => regexPatternInputs.value.name, () => regexPatternInputs.value.pattern], () => {
        if (
            regexPatternInputs.value.name === "" ||
            regexPatternInputs.value.name === undefined ||
            regexPatternInputs.value.pattern === "" ||
            regexPatternInputs.value.pattern === undefined
        ) {
            isFormEmpty.value = true;
        } else {
            isFormEmpty.value = false;
        }
    });

    // Watch for pattern changes to update highlighting
    watch(() => regexPatternInputs.value.pattern, (newPattern) => {
        if (testString.value && queryEditorRef.value) {
            queryEditorRef.value.highlightRegexMatches(newPattern?.trim());
        }
    });

    const getBtnLogo = computed(() => {
        if (isHovered.value || store.state.isAiChatEnabled) {
            return getImageURL('images/common/ai_icon_dark.svg')
        }
        return store.state.theme === 'dark'
            ? getImageURL('images/common/ai_icon_dark.svg')
            : getImageURL('images/common/ai_icon.svg')
    })
    const goToAILogo = computed(() => {
        return getImageURL('images/common/ai_icon_primary.svg')
    })
    const toggleAIChat = () => {
        const isEnabled = !store.state.isAiChatEnabled;
        store.dispatch("setIsAiChatEnabled", isEnabled);
        window.dispatchEvent(new Event("resize"));
    };

    const saveRegexPattern = async () => {
        isSaving.value = true;
        //payload for create and update regex pattern
        // we need to send the name , pattern , description
        const payload = {
            name: regexPatternInputs.value.name,
            pattern: regexPatternInputs.value.pattern,
            description: regexPatternInputs.value.description,
        }
        //here we are emitting close and update:list to the parent component
        //this is used to close the dialog and update the regex pattern list
        try {
            const response = props.isEdit ? await regexPatternService.update(store.state.selectedOrganization.identifier, props.data.id, payload) : await regexPatternService.create(store.state.selectedOrganization.identifier, payload);
            if(response.status == 200){
                q.notify({
                    color: "positive",
                    message: props.isEdit ? "Regex pattern updated successfully" : "Regex pattern created successfully",
                    timeout: 4000,
                });
                emit("close");
                emit("update:list");
            }
        } catch (error) {
            if(error.response.status != 403){
                q.notify({
                    color: "negative",
                    message: error.response?.data?.message || (props.isEdit ? "Failed to update regex pattern" : "Failed to create regex pattern"),
                    timeout: 4000,
                });
            }
        }
        finally{
            isSaving.value = false;
        }
    }

    const toggleFullScreen = () => {
        isFullScreen.value = !isFullScreen.value;
        window.dispatchEvent(new Event("resize"));
    }

    const testStringOutput = async () => {
        try{
            expandState.value.outputString = true;
            outputString.value = "";
            testLoading.value = true;
            const response = await regexPatternService.test(store.state.selectedOrganization.identifier, regexPatternInputs.value.pattern, [testString.value]);
            outputString.value = response.data.results[0];
        } catch (error) {
            q.notify({
                color: "negative",
                message: error.response?.data?.message || "Failed to test string",
                timeout: 4000,
            });
        }
        finally{
            testLoading.value = false;
        }
    }

    const closeAddRegexPatternDialog = () => {
        emit("close");
    }


    return {
        t,
        store,
        q,
        config,
        getBtnLogo,
        isHovered,
        toggleAIChat,
        isFullScreen,
        regexPatternInputs,
        expandState,
        testString,
        isFormEmpty,
        saveRegexPattern,
        isSaving,
        isPatternValid,
        queryEditorRef,
        toggleFullScreen,
        outputString,
        testStringOutput,
        outlinedLightbulb,
        testLoading,
        goToAILogo,
        inputContext,
        closeAddRegexPatternDialog
        }
}
});

  
  
</script>
  
  <style lang="scss">
  .add-regex-pattern-container {
    width: 600px !important;
  }
  .add-regex-pattern-o2ai-enabled {
    width: calc(100vw - 500px) !important;
  }
  .add-regex-pattern-title {
    font-weight: 400;
    font-size: 18px;
    text-align: left;
  }
  .add-regex-pattern-light {
    .add-regex-pattern-title {
        color: #000000;
    }
  }

  .add-regex-pattern-name-input .q-field__control {
    display: flex;
    align-items: center;
    height: 44px;
    }
    .add-regex-pattern-description-input .q-field__control {
    display: flex;
    align-items: center;
    height: 65px;
    }
    .regex-pattern-input-container {
        border: 0px 1px 1px 1px solid #E6E6E6  ;
    }
    .regex-pattern-test-string-container {
        border: 0px 1px 1px 1px solid #E6E6E6  ;
    }


    .dark-mode-regex-pattern-input .q-field__control  { 
        background-color:#181A1B !important;
        border-left: 1px solid #212121 !important;
        border-right: 1px solid #212121 !important;
        border-bottom: 1px solid #212121 !important;
        }
    .light-mode-regex-pattern-input .q-field__control  { 
    background-color:#ffffff !important;
    border-left: 1px solid #E6E6E6 !important;
    border-right: 1px solid #E6E6E6 !important;
    border-bottom: 1px solid #E6E6E6 !important;
    }
    .regex-pattern-input > div > div > div > textarea{
        height: 200px !important;
        resize: none !important;
        padding-left: 0.5rem !important;
    }

    .dark-mode-regex-test-string-input .q-field__control  { 
        background-color:#181A1B !important;
        border-left: 2px solid #212121 !important;
        border-right: 2px solid #212121 !important;
        border-bottom: 2px solid #212121 !important;
    }
    .light-mode-regex-test-string-input { 
    background-color:#ffffff !important;
    border-left: 1px solid #E6E6E6 !important;
    border-right: 1px solid #E6E6E6 !important;
    border-bottom: 1px solid #E6E6E6 !important;
    
    }
.regex-test-string-input > div > div > div > textarea{
    resize: none !important;
    padding-left: 0.5rem !important;
    }
    .is-pattern-valid > div > div  { 
        .q-field__native {
            color: green !important;
        }
    }

  </style>

  <style lang="scss">
      .regex-pattern-test-string-editor{
        .lines-content{
            padding-left: 12px !important;
        }

    }
    .light-mode-regex-test-string-input{
        .monaco-editor-background{
            background-color: #ffffff !important;
        }
    }
    .dark-mode-regex-test-string-input{
        .monaco-editor-background{
            background-color: #181a1b !important;
        }
    }
    .regex-pattern-input-label{
        font-size: 14px;
        font-weight: 700;
        line-height: 21px;
    }
    .add-regex-pattern-dark{
        .regex-pattern-input-label{
            color: #ffffff;
        }
    }
    .add-regex-pattern-light{
        .regex-pattern-input-label{
            color: #6B7280;
        }
    }
    .regex-pattern-test-string-label{
        font-size: 14px;
        font-weight: 700;
        line-height: 21px;
    }
    .add-regex-pattern-dark{
        .regex-pattern-test-string-label{
            color: #ffffff;
        }
    }
    .add-regex-pattern-light{
        .regex-pattern-test-string-label{
            color: #6B7280;
        }
    }
    .dark-test-string-container-label{
        color: #ffffff;
        font-weight: 500;
        font-size: 12px;
        line-height: 21px;
    }
    .light-test-string-container-label{
        color: #6B7280;
        font-weight: 500;
        font-size: 12px;
        line-height: 21px;
        margin-left: -4px;
    }
    .dark-mode-regex-no-output{
        background-color:#181A1B !important;
        border-left: 2px solid #212121 !important;
        border-right: 2px solid #212121 !important;
        border-bottom: 2px solid #212121 !important;
    }
    .light-mode-regex-no-output{
        background-color:#ffffff !important;
        border-left: 1px solid #E6E6E6 !important;
        border-right: 1px solid #E6E6E6 !important;
        border-bottom: 1px solid #E6E6E6 !important;
    }
</style>

  