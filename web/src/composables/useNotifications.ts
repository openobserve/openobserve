import { useQuasar } from "quasar";

const useNotifications = () => {
  const quasar = useQuasar();

  const showErrorNotification = (message: string) => {
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
    });
  };

  const showPositiveNotification = (message: string) => {
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
    });
  };

  return {
    showErrorNotification,
    showPositiveNotification,
  };
};

export default useNotifications;
