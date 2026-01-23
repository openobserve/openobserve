/**
 * Performance timing function with flag control
 * Starts a timer with console.time()
 *
 * @param {string} label - The label for the timer
 *
 * @example
 * logTimeStart("my-operation");
 */
export const logTimeStart = (label: string) => {
  if (true) {
    // Toggle true/false to enable/disable timing logs
    console.time(label);
  }
};

/**
 * Performance timing function with flag control
 * Ends a timer with console.timeEnd()
 *
 * @param {string} label - The label for the timer (must match logTimeStart label)
 *
 * @example
 * logTimeEnd("my-operation");
 */
export const logTimeEnd = (label: string) => {
  if (true) {
    // Toggle true/false to enable/disable timing logs
    console.timeEnd(label);
  }
};

/**
 * Performance message logging function with flag control
 * Logs a message to console.log()
 *
 * @param {string} message - The message to log
 *
 * @example
 * logMessage("Data processing started");
 */
export const logMessage = (message: string) => {
  if (true) {
    // Toggle true/false to enable/disable logs
    console.log(message);
  }
};