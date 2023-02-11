<template>
  <div class="tabContent">
    <div class="tabContent__head">
      <div class="title">CURL</div>
      <div class="copy_action">
        <q-btn
          flat
          round
          size="0.5rem"
          padding="0.6rem"
          icon="img:/src/assets/images/common/copy_icon.svg"
          @click="$emit('copy-to-clipboard-fn', content)"
        />
      </div>
    </div>
    <pre ref="content">
  curl -u {{ currUserEmail }}:{{ store.state.organizationPasscode }} -k {{
        config.zincENLIngestion
      }}/api/{{ currOrgIdentifier }}/default/_json -d [JSON-DATA]</pre
    >
  </div>
</template>

<script>
import { defineComponent, ref } from "vue";
import config from "../../aws-exports";
import { useStore } from "vuex";

export default defineComponent({
  name: "curl-mechanism",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
  },
  setup() {
    const store = useStore();

    const content = ref(null);
    return {
      store,
      config,
      content,
    };
  },
});
</script>

<style scoped lang="scss">
.tabContent {
  background-color: $accent; // tab content bg color
  padding: 1rem 1.25rem 0.5rem;
  border-radius: 0.5rem;

  &__head {
    justify-content: space-between;
    text-transform: uppercase;
    align-items: center;
    display: flex;

    .title {
      font-size: 0.75rem;
      color: $dark-page;
      line-height: 1rem;
      font-weight: 600;
    }

    .copy_action {
      .q-btn {
        background-color: white;
      }
    }
  }

  pre {
    white-space: pre-wrap;
    word-wrap: break-word;
    font-size: 0.75rem;
    color: $dark-page;
    margin-bottom: 0;
  }
}
</style>
