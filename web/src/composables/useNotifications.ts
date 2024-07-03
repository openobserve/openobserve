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

  return {
    showErrorNotification,
    showPositiveNotification,
  };
};

export default useNotifications;
