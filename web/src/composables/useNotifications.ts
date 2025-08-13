import { useQuasar } from "quasar";

const useNotifications = () => {
  const quasar = useQuasar();

  const showErrorNotification = (message: string, options?: any) => {
    return quasar.notify({
      type: "negative",
      message: message,
      timeout: 5000,
      actions: [
        {
          icon: "close",
          color: "white",
          round: true,
          handler: () => {
            /* ... */
          },
        },
      ],
      ...(options || {}),
    });
  };

  const showConfictErrorNotificationWithRefreshBtn = (
    message: string,
    options?: any,
  ) => {
    return quasar.notify({
      type: "negative",
      message: message,
      multiLine: false,
      timeout: 0,
      actions: [
        {
          // icon: "refresh",
          label: "Refresh",
          color: "white",
          style: "font-weight: bold",
          padding: "4px",
          handler: () => {
            // refresh whole page
            window.location.reload();
          },
        },
        {
          icon: "close",
          padding: "4px",
          style: "font-weight: bold",
          color: "white",
          handler: () => {
            /* ... */
          },
        },
      ],
      ...(options || {}),
    });
  };

  const showAliasErrorForVisualization = (
    message: string,
    options?: any,
  ) => {
    return quasar.notify({
      type: "negative",
      message: message,
      multiLine: false,
      timeout: 0,
      actions: [
        {
          icon: "close",
          padding: "4px",
          style: "font-weight: bold",
          color: "white",
          handler: () => {
            /* ... */
          },
        },
      ],
      ...(options || {}),
    });
  };

  const showPositiveNotification = (message: string, options?: any) => {
    return quasar.notify({
      type: "positive",
      message: message,
      timeout: 5000,
      actions: [
        {
          icon: "close",
          color: "white",
          round: true,
          handler: () => {
            /* ... */
          },
        },
      ],
      ...(options || {}),
    });
  };

  const showInfoNotification = (message: string, options?: any) => {
    return quasar.notify({
      type: "info",
      message: message,
      timeout: 5000,
      actions: [
        {
          icon: "close",
          color: "white",
          round: true,
          handler: () => {
            /* ... */
          },
        },
      ],
      ...(options || {}),
    });
  }

  return {
    showErrorNotification,
    showPositiveNotification,
    showInfoNotification,
    showConfictErrorNotificationWithRefreshBtn,
    showAliasErrorForVisualization,
  };
};

export default useNotifications;
