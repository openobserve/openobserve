<template>
  <div data-test="loading-container" class="flex h-[100vh] flex-col items-center justify-center">
    <OSpinner size="lg" data-test="spinner" />
    <div data-test="message" class="text-text-secondary text-base">Redirecting...</div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted } from "vue";
import { useRouter } from "vue-router";
import shortURL from "@/services/short_url";
import { useStore } from "vuex";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

export default defineComponent({
  name: "ShortUrl",
  components: { OSpinner },
  props: {
    id: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const router = useRouter();
    const store = useStore();

    const routeToHome = () => {
      router.replace({
        name: "home",
      });
    };

    const handleOriginalUrl = (url: string) => {
      const urlArray = url.split("/");

      // if the url contains web, then route to the original url

      if (urlArray.includes("web")) {
        routeToOriginalUrl(urlArray.slice(4).join("/"));
      } else {
        routeToOriginalUrl(urlArray.slice(3).join("/"));
      }
    };

    const routeToOriginalUrl = (url: string) => {
      url.startsWith("/") ? router.replace(url) : router.replace("/" + url);
    };

    const fetchAndRedirect = async () => {
      try {
        const response = await shortURL.get(store.state.selectedOrganization.identifier, props.id);

        if (typeof response.data === "string") {
          handleOriginalUrl(response.data);
        } else {
          // Handle case where redirect URL is not found
          routeToHome();
        }
      } catch (error) {
        console.error("Error fetching short URL:", error);
        // Redirect to home page on error
        routeToHome();
      }
    };

    // Execute when component is mounted
    onMounted(() => {
      fetchAndRedirect();
    });

    return {
      routeToHome,
      handleOriginalUrl,
      routeToOriginalUrl,
      fetchAndRedirect,
    };
  },
});
</script>
