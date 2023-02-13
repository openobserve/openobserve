import http from "./http";

const zo_config = {
  get_config: () => {
    return http().get(`/api/config`);
  },

};

export default zo_config;
