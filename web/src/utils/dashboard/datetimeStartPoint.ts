export const dateBin = (interval: number, date: Date, origin: Date): Date => {
  const intervalMs = interval * 1000;
  const sinceOrigin = date.getTime() - origin.getTime();

  // JavaScript `%` keeps the sign, and a date before the origin must still round down.
  const remainder = ((sinceOrigin % intervalMs) + intervalMs) % intervalMs;

  return new Date(date.getTime() - remainder);
};
