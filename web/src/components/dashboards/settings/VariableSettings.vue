<template>
  <q-card class="column full-height">
    <q-card-section class="q-px-md q-py-md text-black">
      <div class="row items-center no-wrap">
        <div class="col">
          <!-- <div v-if="beingUpdated" class="text-body1 text-bold text-dark">
                    {{ t("dashboard.updatedashboard") }}
                    </div>
                    <div v-else class="text-body1 text-bold text-dark">
                    {{ t("dashboard.createdashboard") }}
                    </div> -->
        </div>
        <div class="col-auto">
          <q-btn
            v-close-popup
            round
            flat
            :icon="'img:' + getImageURL('images/common/close_icon.svg')"
          />
        </div>
      </div>
    </q-card-section>
    <q-separator />
    <q-card-section class="q-w-md q-mx-lg">
        <q-btn color="primary" icon="add" :label="t(`dashboard.NewVariable`)" />
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import dashboardService from "../../../services/dashboards";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { isProxy, toRaw } from "vue";
import { getImageURL } from "../../../utils/zincutils";

const defaultValue = () => {
  return {
    id: "",
    name: "",
    description: "",
  };
};

let callDashboard: Promise<{ data: any }>;

export default defineComponent({
  name: "GeneralSettings",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
  },
  emits: ["update:modelValue", "updated", "finish"],
  setup(props) {
    const store: any = useStore();
    const beingUpdated: any = ref(false);
    const addDashboardForm: any = ref(null);
    const disableColor: any = ref("");
    const dashboardData: any = ref(defaultValue());
    const isValidIdentifier: any = ref(true);
    const { t } = useI18n();

    onMounted(() => {
      if (props.modelValue && props.modelValue.id) {
        beingUpdated.value = true;
        disableColor.value = "grey-5";
      }
    });

    //generate random integer number for dashboard Id
    function getRandInteger() {
      return Math.floor(Math.random() * (9999999999 - 100 + 1)) + 100;
    }

    return {
      t,
      disableColor,
      isPwd: ref(true),
      beingUpdated,
      status,
      dashboardData,
      addDashboardForm,
      store,
      getRandInteger,
      isValidIdentifier,
      getImageURL,
    };
  },
});
</script>
