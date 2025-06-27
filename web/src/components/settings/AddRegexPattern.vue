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
    <div
      class="q-pt-md"
      
      :class="[store.state.theme === 'dark' ? 'bg-dark add-regex-pattern-dark' : 'bg-white add-regex-pattern-light',
      ]"
          :style="{
            width: isFullScreen  ? '100vw' : store.state.isAiChatEnabled ? '70vw' : '40vw'
            }"
    >
      <div class="add-regex-pattern-header q-px-md tw-flex tw-items-center tw-justify-between">
        <div class="tw-flex tw-items-center tw-justify-between">
                <q-btn
                    data-test="add-stream-close-btn"
                    v-close-popup="true"
                    round
                    flat
                    icon="arrow_back"
                />
          <div class="add-regex-pattern-title" data-test="add-regex-pattern-title">
            {{ isEdit ? t("regex_patterns.edit_regex_pattern") : t("regex_patterns.create_regex_pattern") }}
          </div>
        </div>
        <div class="tw-flex tw-items-center tw-justify-between tw-gap-2">
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
            <div class="row items-center no-wrap tw-gap-2  ">
                <img  :src="getBtnLogo" class="header-icon ai-icon" />
            </div>
            </q-btn>
            <q-btn 
            icon="fullscreen" 
            size="14px" 
            dense 
            class="tw-cursor-pointer" 
            :class="store.state.theme === 'dark' ? 'tw-text-white' : ''"
            :color="isFullScreen ? 'primary' : undefined"
            @click="() => isFullScreen = !isFullScreen" 
          />
          <q-btn
            data-test="add-regex-pattern-close-btn"
            v-close-popup="true"
            round
            flat
            icon="close"
        />
        </div>

      </div>
      <q-separator class="q-mb-md q-mt-sm" />
      <!-- form inputs starts here -->
       <div class="tw-flex tw-w-[100%]">
            <div class=" "
            :class="store.state.isAiChatEnabled ? isFullScreen ? 'tw-w-[85%] q-pl-sm' : 'tw-w-[65%] q-pl-sm' : 'tw-w-[100%] q-px-md'"
            >
            <q-form @submit="saveRegexPattern" class="tw-flex tw-flex-col tw-gap-4" style="overflow: auto; height: calc(100vh - 150px);">
                <div class="tw-flex tw-flex-col">
                    <q-input
                        v-bind:readonly="isEdit"
                        v-bind:disable="isEdit"
                        v-model="regexPatternInputs.name"
                        :label="t('regex_patterns.name') + ' *'"
                        color="input-border"
                        bg-color="input-bg"
                        class="showLabelOnTop"
                        data-test="add-regex-pattern-name-input"
                        stack-label
                        outlined
                        filled
                        dense
                        :lazy-rules="true"
                        :rules="[val => val !== '' || '* Name is required']"
                        />
                    <q-input
                        v-model="regexPatternInputs.description"
                        :label="t('regex_patterns.description')"
                        color="input-border"
                        bg-color="input-bg"
                        class="q-pb-md showLabelOnTop"
                        stack-label
                        outlined
                        filled
                        dense
                        data-test="add-regex-pattern-description-input"
                        />
                <div class="regex-pattern-input-container">
                    <FullViewContainer
                        style="padding: 12px 8px;"
                        :style="{
                            'background-color': store.state.theme === 'dark' ? '#2A2929' : '#fafafa',
                            'border': store.state.theme === 'dark' ? '' : '1px solid #E6E6E6'
                        }"
                        name="query"
                        v-model:is-expanded="expandState.regexPattern"
                        label="Regular Expression*"
                        class="tw-mt-1 tw-py-md"
                        labelClass="tw-py-md"
                        :o2AIicon="true"
                        @toggleO2Ai="toggleAIChat"
                    />
                    <div v-if="expandState.regexPattern" class="regex-pattern-input">
                        <q-input
                        data-test="regex-pattern-input-textarea"
                        v-model="regexPatternInputs.pattern"
                        color="input-border"
                        bg-color="input-bg"
                        class="regex-pattern-input"
                        :class="store.state.theme === 'dark' ? 'dark-mode-regex-pattern-input' : 'light-mode-regex-pattern-input'"
                        stack-label
                        outlined
                        filled
                        dense
                        tabindex="0"
                        style="width: 100%; resize: none;"
                        type="textarea"
                        placeholder="Eg. \d....\d "
                        rows="5"
                        @update:model-value='updatePatternInputs'
                        :rules="[val => val !== '' || '* Pattern is required']"
                        />
                    </div>
                </div>
                <div class="regex-pattern-test-string-container">
                    <FullViewContainer
                        style="padding: 12px 8px; "
                        :style="{
                            'background-color': store.state.theme === 'dark' ? '#2A2929' : '#fafafa',
                            'border': store.state.theme === 'dark' ? '' : '1px solid #E6E6E6'
                        }"
                        name="query"
                        v-model:is-expanded="expandState.regexTestString"
                        label="Test String"
                        class="tw-mt-1 tw-py-md"
                        labelClass="tw-py-md"
                        :o2AIicon="false"
                    />
                    <div v-if="expandState.regexTestString" class="regex-pattern-input">
                        <div 
                            ref="editableDiv"
                            contenteditable="true"
                            class="editable-div"
                            :class="[
                                store.state.theme === 'dark' ? 'dark-mode' : 'light-mode',
                            ]"
                            @input="handleTestStringInput"
                            @paste="handlePaste"
                            :placeholder="'Eg. yhk1abc2'"
                            v-html="highlightedText"
                        ></div>
                    </div>
                </div>
                </div>

            </q-form>
            <div class="flex justify-end q-mt-sm" style="position: sticky; bottom: 0; right: 0;">
                <q-btn
                    v-close-popup="true"
                    data-test="add-stream-cancel-btn"
                    :label="t('regex_patterns.cancel')"
                    class="q-my-sm text-bold q-mr-md"
                    padding="sm md"
                    no-caps
                    style="border: 1px solid #E6E6E6;"
                />
                <q-btn
                    data-test="save-stream-btn"
                    :label="isSaving ? 'Saving...' : isEdit ? t('regex_patterns.update_close') : t('regex_patterns.create_close')"
                    class="q-my-sm text-bold no-border"
                    :style="{
                        'background-color': isFormEmpty ? '#aeaeae' : '#5ca380',
                        'color': isFormEmpty  ? store.state.theme === 'dark' ? '#ffffff' : '#000000' : '#ffffff'
                        }"
                    padding="sm xl"
                    type="submit"
                    no-caps
                    @click="saveRegexPattern"
                    :disable="isFormEmpty || isSaving"
                />
            </div>
            </div>
            <div  class="q-ml-sm" v-if="store.state.isAiChatEnabled " style="width:35%; max-width: 100%; min-width: 75px; height: calc(100vh - 90px) !important;  " :class="store.state.theme == 'dark' ? 'dark-mode-chat-container' : 'light-mode-chat-container'" >
              <O2AIChat style="height: calc(100vh - 90px) !important;" :is-open="store.state.isAiChatEnabled" @close="store.state.isAiChatEnabled = false" />

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

            const testString = ref("");
            const highlightedText = ref("");
            const editableDiv = ref<HTMLElement | null>(null);
            let savedSelection: { start: number; end: number } | null = null;

            const isFormEmpty = ref(props.isEdit ? false : true);

            const isPatternValid = ref(false);

            onMounted(()=>{
                if(props.isEdit){
                    regexPatternInputs.value.name = props.data.name;
                    regexPatternInputs.value.pattern = props.data.pattern;
                }
                else{
                    regexPatternInputs.value = {
                        name: "",
                        pattern: "",
                        description: ""
                    }
                }
            })

            const isSaving = ref(false);
            const regexPatternInputs: any = ref({
                name: "",
                pattern: "",
                description: "",//this is optional we dont consider it anyway
            });

            const expandState = ref({
                regexPattern: true,
                regexTestString: true,
            });



            const getBtnLogo = computed(() => {
                if (isHovered.value || store.state.isAiChatEnabled) {
                    return getImageURL('images/common/ai_icon_dark.svg')
                }
                return store.state.theme === 'dark'
                    ? getImageURL('images/common/ai_icon_dark.svg')
                    : getImageURL('images/common/ai_icon.svg')
            })
            const toggleAIChat = () => {
                const isEnabled = !store.state.isAiChatEnabled;
                store.dispatch("setIsAiChatEnabled", isEnabled);
                window.dispatchEvent(new Event("resize"));
            };

            const saveSelection = () => {
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0 && editableDiv.value) {
                    const range = selection.getRangeAt(0);
                    savedSelection = {
                        start: range.startOffset,
                        end: range.endOffset
                    };
                }
            };

            const restoreSelection = () => {
                if (savedSelection && editableDiv.value) {
                    const selection = window.getSelection();
                    const range = document.createRange();
                    let childNodes = Array.from(editableDiv.value.childNodes);
                    let currentPos = 0;
                    let startNode: Node = editableDiv.value;
                    let endNode: Node = editableDiv.value;
                    let startOffset = savedSelection.start;
                    let endOffset = savedSelection.end;

                    // Find the correct nodes and offsets
                    for (let node of childNodes) {
                        const length = node.textContent?.length || 0;
                        if (currentPos + length >= savedSelection.start) {
                            startNode = node;
                            startOffset = savedSelection.start - currentPos;
                            break;
                        }
                        currentPos += length;
                    }

                    currentPos = 0;
                    for (let node of childNodes) {
                        const length = node.textContent?.length || 0;
                        if (currentPos + length >= savedSelection.end) {
                            endNode = node;
                            endOffset = savedSelection.end - currentPos;
                            break;
                        }
                        currentPos += length;
                    }

                    if (selection) {
                        range.setStart(startNode, startOffset);
                        range.setEnd(endNode, endOffset);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                }
            };

            // Create debounced function as a ref so we can clean it up
            const debouncedUpdatePatternInputs = ref(debounce(() => {
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

                isPatternValid.value = false;
                
                if (regexPatternInputs.value.pattern && testString.value) {
                    try {
                        const regex = new RegExp(regexPatternInputs.value.pattern, 'g');
                        let text = testString.value;
                        
                        // Save current cursor position relative to text content
                        const selection = window.getSelection();
                        let cursorOffset = 0;
                        if (selection && selection.rangeCount > 0 && editableDiv.value) {
                            const range = selection.getRangeAt(0);
                            const preCaretRange = range.cloneRange();
                            preCaretRange.selectNodeContents(editableDiv.value);
                            preCaretRange.setEnd(range.endContainer, range.endOffset);
                            cursorOffset = preCaretRange.toString().length;
                        }

                        // Generate highlighted HTML
                        let html = text;
                        const matches = Array.from(text.matchAll(regex));
                        
                        // Replace matches from end to start to avoid position issues
                        for (let i = matches.length - 1; i >= 0; i--) {
                            const match = matches[i];
                            if (match.index !== undefined) {
                                const start = match.index;
                                const end = start + match[0].length;
                                const before = html.substring(0, start);
                                const matched = html.substring(start, end);
                                const after = html.substring(end);
                                html = before + `<span class="match">${matched}</span>` + after;
                            }
                        }
                        
                        highlightedText.value = html;
                        isPatternValid.value = matches.length > 0;

                        // Restore cursor position after Vue updates the DOM
                        nextTick(() => {
                            if (editableDiv.value) {
                                // Create a temporary div to count positions including newlines
                                const tempDiv = document.createElement('div');
                                tempDiv.innerHTML = html;
                                
                                const textNodes = [];
                                const offsets = [];
                                let totalOffset = 0;
                                
                                // Walk through all nodes and calculate their positions
                                const walk = document.createTreeWalker(
                                    editableDiv.value,
                                    NodeFilter.SHOW_TEXT,
                                    null
                                );
                                
                                let node;
                                while (node = walk.nextNode()) {
                                    textNodes.push(node);
                                    offsets.push(totalOffset);
                                    totalOffset += node.textContent?.length || 0;
                                }

                                // Find the right node and offset
                                let targetNode = textNodes[0];
                                let targetOffset = 0;

                                for (let i = 0; i < textNodes.length; i++) {
                                    const nextOffset = i + 1 < offsets.length ? offsets[i + 1] : totalOffset;
                                    if (offsets[i] <= cursorOffset && cursorOffset <= nextOffset) {
                                        targetNode = textNodes[i];
                                        targetOffset = cursorOffset - offsets[i];
                                        break;
                                    }
                                }

                                if (targetNode && selection) {
                                    const range = document.createRange();
                                    range.setStart(targetNode, targetOffset);
                                    range.setEnd(targetNode, targetOffset);
                                    selection.removeAllRanges();
                                    selection.addRange(range);
                                    
                                    // Ensure the cursor is visible
                                    const rect = range.getBoundingClientRect();
                                    if (rect) {
                                        editableDiv.value.scrollTop = rect.top - editableDiv.value.offsetHeight / 2;
                                    }
                                }
                            }
                        });
                    } catch (error) {
                        isPatternValid.value = false;
                        console.log(error);
                    }
                } else {
                    highlightedText.value = testString.value;
                }
            }, 300));

            // Add cleanup
            onBeforeUnmount(() => {
                // Cancel any pending debounced calls
                if (debouncedUpdatePatternInputs.value?.cancel) {
                    debouncedUpdatePatternInputs.value.cancel();
                }
                
                // Clear references
                editableDiv.value = null;
                savedSelection = null;
            });

            const handleTestStringInput = (event: InputEvent) => {
                const target = event.target as HTMLElement;
                testString.value = target.innerText;
                debouncedUpdatePatternInputs.value();
            };

            const handlePaste = (event: ClipboardEvent) => {
                event.preventDefault();
                const text = event.clipboardData?.getData('text/plain') || '';
                document.execCommand('insertText', false, text);
            };

            const saveRegexPattern = async () => {
                isSaving.value = true;
                const payload = {
                    name: regexPatternInputs.value.name,
                    pattern: regexPatternInputs.value.pattern,
                    description: regexPatternInputs.value.description,
                }

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
                updatePatternInputs: debouncedUpdatePatternInputs.value,
                saveRegexPattern,
                isSaving,
                isPatternValid,
                editableDiv,
                handleTestStringInput,
                handlePaste,
                highlightedText,
                saveSelection,
                restoreSelection
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
    .add-regex-pattern-pattern-input .q-field__control {
    display: flex;
    align-items: center;
    height: 200px;
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
    }

    .dark-mode-regex-test-string-input .q-field__control  { 
    background-color:#181A1B !important;
    border-left: 1px solid #212121 !important;
        border-right: 1px solid #212121 !important;
        border-bottom: 1px solid #212121 !important;
    }
    .light-mode-regex-test-string-input .q-field__control  { 
    background-color:#ffffff !important;
    border-left: 1px solid #E6E6E6 !important;
    border-right: 1px solid #E6E6E6 !important;
    border-bottom: 1px solid #E6E6E6 !important;
    
    }
.regex-test-string-input > div > div > div > textarea{
    resize: none !important;
    }
    .is-pattern-valid > div > div  { 
        .q-field__native {
            color: green !important;
        }
    }

    .editable-div {
        height: 150px;
        max-height: 150px;
        padding: 12px;
        border: 1px solid #E6E6E6;
        border-radius: 4px;
        outline: none;
        font-family: monospace;
        white-space: pre-wrap;
        overflow-wrap: break-word;
        
        &.dark-mode {
            background-color: #181A1B;
            border-color: #212121;
            color: #ffffff;
        }
        
        &.light-mode {
            background-color: #ffffff;
            border-color: #E6E6E6;
            color: #000000;
        }

        &:empty:before {
            content: attr(placeholder);
            color: #999;
        }

        .match {
            background-color: rgba(92, 163, 128, 0.3);
            border-radius: 2px;
        }
    }

  </style>
  