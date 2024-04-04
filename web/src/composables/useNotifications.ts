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
          handler: () => {
            /* ... */
          },
        },
      ],
    });
  };

  return {
    showErrorNotification,
  };
};

export default useNotifications;
