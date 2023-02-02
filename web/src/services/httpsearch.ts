import store from "../stores";
import router from "../router";
import axios from "axios";
import { Notify } from "quasar";

const http = () => {
  const instance = axios.create({
    // timeout: 10000,
    baseURL: store.state.API_ENDPOINT,
    headers: {
      Authorization: "Bearer " + localStorage.getItem("token"),
    },
  });

  instance.interceptors.response.use(
    function (response) {
      return response;
    },
    function (error) {
      if (error && error.response && error.response.status) {
        switch (error.response.status) {
          case 400:
            Notify.create({
              position: "bottom-right",
              progress: true,
              multiLine: true,
              color: "red-5",
              textColor: "white",
              icon: "warning",
              message: JSON.stringify(
                error.response.data["error"] || "Bad Request"
              ),
            });
            break;
          case 401:
            Notify.create({
              position: "bottom-right",
              progress: true,
              multiLine: true,
              color: "red-5",
              textColor: "white",
              icon: "warning",
              message: error.response.data["error"] || "Invalid credentials",
            });
            store.dispatch("logout");
            localStorage.clear();
            sessionStorage.clear();
            window.location.reload();
            break;
          case 404:
            Notify.create({
              position: "bottom-right",
              progress: true,
              multiLine: true,
              color: "red-5",
              textColor: "white",
              icon: "warning",
              message: error.response.data["error"] || "Not Found",
            });
            break;
          case 500:
            Notify.create({
              position: "bottom-right",
              progress: true,
              multiLine: true,
              color: "red-5",
              textColor: "white",
              icon: "warning",
              message: JSON.stringify(
                error.response.data["error"] || "Internal ServerError"
              ),
            });
            break;
          default:
          // noop
        }
      }
      return Promise.reject(error);
    }
  );

  return instance;
};

export default http;
