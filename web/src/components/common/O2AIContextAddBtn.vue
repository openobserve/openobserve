<template>
    <!-- ai button is only enabled when it is enteprise version and also ai is enabled from the BE -->
    <q-btn
        v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
        :ripple="false"
        @click.stop="sendToAiChat"
        data-test="o2-ai-context-add-btn"
        no-caps
        :borderless="true"
        flat
        :size="props.size"
        dense
        :class="[
            props.class,
        ]"
        :style="props.style"
        style="border-radius: 100%;"
        >
        <div class="row items-center no-wrap">
            <img :height="props.imageHeight" :width="props.imageWidth"  :src="getBtnLogo" class="header-icon ai-icon" />
        </div>
    </q-btn>
</template>

<script setup lang="ts">
import { getImageURL } from '@/utils/zincutils';
import { computed } from 'vue';
import { useStore } from 'vuex';
import config from '@/aws-exports';
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
    : getImageURL('images/common/ai_icon.svg')
})
//this function is responsible for sending the event / button is clicked to the parent component
const sendToAiChat = () => {
    emit('sendToAiChat')
}
</script>

<style scoped lang="scss">
</style>