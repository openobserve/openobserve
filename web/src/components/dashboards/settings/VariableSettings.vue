<template>
    <div class="column full-height">
        <div>
            <q-btn color="primary" icon="add" :label="t(`dashboard.NewVariable`)" />
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onActivated } from "vue";
import dashboardService from "../../../services/dashboards";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import { getImageURL } from "../../../utils/zincutils";
import { getDashboard } from "../../../utils/commons";

const defaultValue = () => {
  return {
    id: "",
    name: "",
    description: "",
  };
};

let callDashboard: Promise<{ data: any }>;

export default defineComponent({
  name: "VariableSettings",
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
    const route = useRoute();

    onMounted(async () => {
        await getDashboardData();
      if (props.modelValue && props.modelValue.id) {
        beingUpdated.value = true;
        disableColor.value = "grey-5";
      }
    });

    onActivated(async () => {
      console.log("on activated called");
      
      await getDashboardData();
    })

   
    const getDashboardData = async () => {
        let data = JSON.parse(JSON.stringify(await getDashboard(store,route.query.dashboard)))
        console.log("data=", data);
        
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
      isValidIdentifier,
      getImageURL,
      getDashboardData
    };
  },
});
</script>
