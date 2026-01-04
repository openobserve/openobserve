<template>
  <div
    data-test="loading-container"
    class="tw:h-[100vh] tw:flex tw:flex-col tw:items-center tw:justify-center"
  >
    <q-spinner data-test="spinner" color="primary" size="3em" :thickness="2" />
    <div data-test="message" class="message">Redirecting...</div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import shortURL from "@/services/short_url";
import { useStore } from "vuex";

export default defineComponent({
  name: "ShortUrl",
  props: {
    id: {
      type: String,
      required: true,
    },
  },
  setup(props, { emit }) {
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
        const response = await shortURL.get(
          store.state.selectedOrganization.identifier,
          props.id,
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

    return {
      routeToHome,
      handleOriginalUrl,
      routeToOriginalUrl,
      fetchAndRedirect,
    };
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

.spinner {
  border: 4px solid rgba(0, 0, 0, 0.1);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border-left-color: #09f;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.message {
  font-size: 16px;
  color: #666;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
