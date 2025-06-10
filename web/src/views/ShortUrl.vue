<template>
  <div class="loading-container">
    <q-spinner class="tw-mb-2" size="3em" color="primary" />
    <div class="message">Redirecting...</div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import shortURL from "@/services/short_url";
import { useStore } from "vuex";

export default defineComponent({
  name: "ShortUrl",
  setup() {
    const route = useRoute();
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
        const id = route.params.id as string;
        const response = await shortURL.get(
          store.state.selectedOrganization.identifier,
          id,
        );

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
  },
});
</script>

<style scoped>
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
}

.message {
  font-size: 16px;
  color: #666;
}
</style>
