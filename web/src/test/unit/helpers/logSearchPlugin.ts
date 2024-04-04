import { config } from "@vue/test-utils";

// locally defined plugin, see "Writing a Plugin"
import SearchPlugin from "@/plugins/index";

// Install a plugin onto VueWrapper
export default (options: {}) => {
  config.global.plugins.unshift([SearchPlugin, options]);
};
