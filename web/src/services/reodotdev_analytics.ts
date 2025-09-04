import { ref } from "vue";
import { loadReoScript } from "reodotdev";
import config from "../aws-exports";

interface IdentityPayload {
  username: string;
  type: "linkedin" | "github" | "email" | "google" | "others" | "sso";
  firstname?: string;
  lastname?: string;
  company?: string;
}

const isLoaded = ref(false);
let reoInstance: any = null;

const clientID = config.REO_CLIENT_KEY || "";
const source = "app";
const enableAnalytics = config.enableAnalytics === "true" && config.isCloud === "true";

// queue for events fired before SDK is ready
const eventQueue: Array<{ type: "track" | "identify"; args: any[] }> = [];

function flushQueue() {
  if (isLoaded.value && reoInstance) {
    eventQueue.forEach((item) => {
      if (item.type === "track") {
        const [eventName, payload] = item.args;
        reoInstance.pushData({
          activity: eventName,
          ...payload
        });
      } else if (item.type === "identify") {
        reoInstance.identify(...item.args);
      }
    });
    eventQueue.length = 0;
  }
}

export function useReo() {
  const reoInit = async () => {
    if (!enableAnalytics) {
      return;
    }

    try {
      const Reo = await loadReoScript({ clientID, source });

      Reo.init({ clientID });
      reoInstance = Reo;
      isLoaded.value = true;

      flushQueue();
    } catch (error) {
      console.error("Failed initializing Reo.Dev:", error);
    }
  };

  const identify = (identity: IdentityPayload) => {
    if (!enableAnalytics) {
      return Promise.resolve();
    }

    if (!reoInstance) {
      console.warn("Reo not initialized yet. Queuing identify.");
      eventQueue.push({ type: "identify", args: [identity] });
      return Promise.resolve();
    }

    reoInstance.identify(identity);
  };

  const track = (eventName: string, payload?: Record<string, any>) => {
    if (!enableAnalytics) {
      return;
    }

    if (!reoInstance) {
      console.warn("Reo not initialized yet. Queuing track:", eventName);
      eventQueue.push({ type: "track", args: [eventName, payload] });
      return;
    }

    reoInstance.pushData({
      activity: eventName,
      ...payload
    });
  };
  

  return {
    reoInit,
    identify,
    track,
    isLoaded,
  };
}
