<template>
  <div class="tabContent">
    <div class="tabContent__head">
      <div class="title">Vector</div>
      <div class="copy_action">
        <q-btn
          flat
          round
          size="0.5rem"
          padding="0.6rem"
          icon="img:/assets/images/common/copy_icon.svg"
          @click="$emit('copy-to-clipboard-fn', vectorContent)"
        />
      </div>
    </div>
    <pre ref="vectorContent">
[sinks.zinc]
type = "http"
inputs = [ source or transform id ]
endpoint = "{{ config.zincENLEndPoint }}/api/{{ currOrgIdentifier }}/"
mode = "bulk"
auth.strategy = "basic"
auth.user = "{{ currUserEmail }}"
auth.password = "{{ store.state.organizationPasscode }}"
bulk.index = "default"
compression = "none"
healthcheck.enabled = false</pre
    >
  </div>
</template>

<script>
import { defineComponent, ref, onMounted } from "vue";
import config from "../../aws-exports";
import { useStore } from "vuex";

export default defineComponent({
  name: "Fluentbit",
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

    const vectorContent = ref(null);
    return {
      store,
      config,
      vectorContent,
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