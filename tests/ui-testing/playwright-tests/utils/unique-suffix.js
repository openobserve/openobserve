// A short suffix that keeps the names one test run creates apart from another run's.
const uniqueSuffix = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

module.exports = { uniqueSuffix };
