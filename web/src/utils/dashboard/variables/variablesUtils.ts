
export const formatInterval = (interval: any) => {
  switch (true) {
    // 0.01s
    case interval <= 10:
      return { value: 1, unit: "ms" }; // 0.001s
    // 0.015s
    case interval <= 15:
      return { value: 10, unit: "ms" }; // 0.01s
    // 0.035s
    case interval <= 35:
      return { value: 20, unit: "ms" }; // 0.02s
    // 0.075s
    case interval <= 75:
      return { value: 50, unit: "ms" }; // 0.05s
    // 0.15s
    case interval <= 150:
      return { value: 100, unit: "ms" }; // 0.1s
    // 0.35s
    case interval <= 350:
      return { value: 200, unit: "ms" }; // 0.2s
    // 0.75s
    case interval <= 750:
      return { value: 500, unit: "ms" }; // 0.5s
    // 1.5s
    case interval <= 1500:
      return { value: 1, unit: "s" }; // 1s
    // 3.5s
    case interval <= 3500:
      return { value: 2, unit: "s" }; // 2s
    // 7.5s
    case interval <= 7500:
      return { value: 5, unit: "s" }; // 5s
    // 12.5s
    case interval <= 12500:
      return { value: 10, unit: "s" }; // 10s
    // 17.5s
    case interval <= 17500:
      return { value: 15, unit: "s" }; // 15s
    // 25s
    case interval <= 25000:
      return { value: 20, unit: "s" }; // 20s
    // 45s
    case interval <= 45000:
      return { value: 30, unit: "s" }; // 30s
    // 1.5m
    case interval <= 90000:
      return { value: 1, unit: "m" }; // 1m
    // 3.5m
    case interval <= 210000:
      return { value: 2, unit: "m" }; // 2m
    // 7.5m
    case interval <= 450000:
      return { value: 5, unit: "m" }; // 5m
    // 12.5m
    case interval <= 750000:
      return { value: 10, unit: "m" }; // 10m
    // 17.5m
    case interval <= 1050000:
      return { value: 15, unit: "m" }; // 15m
    // 25m
    case interval <= 1500000:
      return { value: 20, unit: "m" }; // 20m
    // 45m
    case interval <= 2700000:
      return { value: 30, unit: "m" }; // 30m
    // 1.5h
    case interval <= 5400000:
      return { value: 1, unit: "h" }; // 1h
    // 2.5h
    case interval <= 9000000:
      return { value: 2, unit: "h" }; // 2h
    // 4.5h
    case interval <= 16200000:
      return { value: 3, unit: "h" }; // 3h
    // 9h
    case interval <= 32400000:
      return { value: 6, unit: "h" }; // 6h
    // 24h
    case interval <= 86400000:
      return { value: 12, unit: "h" }; // 12h
    // 48h
    case interval <= 172800000:
      return { value: 24, unit: "h" }; // 24h
    // 1w
    case interval <= 604800000:
      return { value: 24, unit: "h" }; // 24h
    // 3w
    case interval <= 1814400000:
      return { value: 1, unit: "w" }; // 1w
    // 2y
    case interval < 3628800000:
      return { value: 30, unit: "d" }; // 30d
    default:
      return { value: 1, unit: "y" }; // 1y
  }
};

export const getTimeInSecondsBasedOnUnit = (seconds: any, unit: any) => {
  switch (true) {
    case unit === "ms":
      return seconds / 1000;
    case unit === "s":
      return seconds;
    case unit === "m":
      return seconds * 60;
    case unit === "h":
      return seconds * 60 * 60;
    case unit === "d":
      return seconds * 60 * 60 * 24;
    case unit === "w":
      return seconds * 60 * 60 * 24 * 7;
    case unit === "y":
      return seconds * 60 * 60 * 24 * 7 * 12;
    default:
      return seconds;
  }
};

export const formatRateInterval = (interval: any) => {
  let formattedStr = "";
  const days = Math.floor(interval / (3600 * 24));
  if (days > 0) formattedStr += days.toString() + "d";

  const hours = Math.floor((interval % (3600 * 24)) / 3600);
  if (hours > 0) formattedStr += hours.toString() + "h";

  const minutes = Math.floor((interval % 3600) / 60);
  if (minutes > 0) formattedStr += minutes.toString() + "m";

  const remainingSeconds = interval % 60;
  if (remainingSeconds > 0) formattedStr += remainingSeconds.toString() + "s";

  return formattedStr;
};
