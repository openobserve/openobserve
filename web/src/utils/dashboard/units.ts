export const units: any = {
    bytes: [
        { unit: "B", divisor: 1 },
        { unit: "KB", divisor: 1024 },
        { unit: "MB", divisor: 1024 * 1024 },
        { unit: "GB", divisor: 1024 * 1024 * 1024 },
        { unit: "TB", divisor: 1024 * 1024 * 1024 * 1024 },
        { unit: "PB", divisor: 1024 * 1024 * 1024 * 1024 * 1024 },
    ],
    seconds: [
        { unit: "ns", divisor: 0.000000001 },
        { unit: "μs", divisor: 0.000001 },
        { unit: "ms", divisor: 0.001 },
        { unit: "s", divisor: 1 },
        { unit: "m", divisor: 60 },
        { unit: "h", divisor: 3600 },
        { unit: "D", divisor: 86400 },
        { unit: "M", divisor: 2592000 }, // Assuming 30 days in a month
        { unit: "Y", divisor: 31536000 }, // Assuming 365 days in a year
    ],
    microseconds: [
        { unit: "ns", divisor: 0.001 },
        { unit: "μs", divisor: 1 },
        { unit: "ms", divisor: 1000 },
        { unit: "s", divisor: 1000000 },
        { unit: "m", divisor: 60 * 1000000 },
        { unit: "h", divisor: 3600 * 1000000 },
        { unit: "D", divisor: 86400 * 1000000 },
        { unit: "M", divisor: 2592000 * 1000000 }, // Assuming 30 days in a month
        { unit: "Y", divisor: 31536000 * 1000000 }, // Assuming 365 days in a year
    ],
    milliseconds: [
        { unit: "ns", divisor: 0.000001 },
        { unit: "μs", divisor: 0.001 },
        { unit: "ms", divisor: 1 },
        { unit: "s", divisor: 1000 },
        { unit: "m", divisor: 60 * 1000 },
        { unit: "h", divisor: 3600 * 1000 },
        { unit: "D", divisor: 86400 * 1000 },
        { unit: "M", divisor: 2592000 * 1000 }, // Assuming 30 days in a month
        { unit: "Y", divisor: 31536000 * 1000 }, // Assuming 365 days in a year
    ],
    nanoseconds: [
        { unit: "ns", divisor: 1 },
        { unit: "μs", divisor: 1000 },
        { unit: "ms", divisor: 1000000 },
        { unit: "s", divisor: 1000000000 },
        { unit: "m", divisor: 60 * 1000000000 },
        { unit: "h", divisor: 3600 * 1000000000 },
        { unit: "D", divisor: 86400 * 1000000000 },
        { unit: "M", divisor: 2592000 * 1000000000 }, // Assuming 30 days in a month
        { unit: "Y", divisor: 31536000 * 1000000000 }, // Assuming 365 days in a year
    ],
    bps: [
        { unit: "B/s", divisor: 1 },
        { unit: "KB/s", divisor: 1024 },
        { unit: "MB/s", divisor: 1024 * 1024 },
        { unit: "GB/s", divisor: 1024 * 1024 * 1024 },
        { unit: "TB/s", divisor: 1024 * 1024 * 1024 * 1024 },
        { unit: "PB/s", divisor: 1024 * 1024 * 1024 * 1024 * 1024 },
    ],
    kilobytes: [
        { unit: "B", divisor: 1 / 1024 },
        { unit: "KB", divisor: 1 },
        { unit: "MB", divisor: 1024 },
        { unit: "GB", divisor: 1024 * 1024 },
        { unit: "TB", divisor: 1024 * 1024 * 1024 },
        { unit: "PB", divisor: 1024 * 1024 * 1024 * 1024 },
    ],
    megabytes: [
        { unit: "B", divisor: 1 / (1024 * 1024) },
        { unit: "KB", divisor: 1 / 1024 },
        { unit: "MB", divisor: 1 },
        { unit: "GB", divisor: 1024 },
        { unit: "TB", divisor: 1024 * 1024 },
        { unit: "PB", divisor: 1024 * 1024 * 1024 },
    ],
    numbers: [
        { unit: "", divisor: 1 },
        { unit: "K", divisor: 1e3 },
        { unit: "M", divisor: 1e6 },
        { unit: "B", divisor: 1e9 },
        { unit: "T", divisor: 1e12 },
        { unit: "Q", divisor: 1e15 },
    ],
};
