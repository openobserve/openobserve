<template>
    <!-- ai button is only enabled when it is enteprise version and also ai is enabled from the BE -->
    <OButton
        v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
        variant="ghost"
        size="icon-toolbar"
        @click.stop="sendToAiChat"
        data-test="o2-ai-context-add-btn"
        :class="['group o2-ai-context-btn', props.class]"
        :style="props.style"
        >
        <div class="flex items-center flex-nowrap">
            <img :height="props.imageHeight" :width="props.imageWidth" :src="getBtnLogo" class="header-icon ai-icon [transition:transform_0.6s_ease,filter_0.6s_ease] group-hover:brightness-0 group-hover:invert group-hover:rotate-180" />
        </div>
    </OButton>
</template>

<script setup lang="ts">
import { getImageURL } from '@/utils/zincutils';
import { computed } from 'vue';
import { useStore } from 'vuex';
import config from '@/aws-exports';
import OButton from '@/lib/core/Button/OButton.vue';
//we can pass class to the button to make it customized
//all of the props are optional
const props = defineProps({
    class: {
        type: String,
        default: '',
        required: false
    },
    //the size of the button can be in xs , sm , md , lg , xl
    //can be in pixels as well
    size: {
        type: String,
        default: 'xs',
        required: false
    },
    style:{
        type: String,
        default: '',
        required: false
    },
    //this is for image height and width sometimes we need to change the size of the image
    imageHeight:{
        type: String,
        default: '20px',
        required: false
    },
    imageWidth:{
        type: String,
        default: '20px',
        required: false
    }
});
//once user clicks on the button, it will emit the event to the parent component
const emit = defineEmits(["sendToAiChat"]);
const store = useStore();
const getBtnLogo = computed(() => {
    return store.state.theme === 'dark'
    ? getImageURL('images/common/ai_icon_dark.svg')
    : getImageURL('images/common/ai_icon_gradient.svg')
})
//this function is responsible for sending the event / button is clicked to the parent component
const sendToAiChat = () => {
    emit('sendToAiChat')
}
</script>

