// Error utilities for Panel Data Loader

export type ErrorDetail = {
  message: string;
  code: string;
};

export const computeErrorDetail = (
  error: any,
  type: 'promql' | 'sql',
  opts: { isWebsocket: boolean; isStreaming: boolean },
): ErrorDetail => {
  if (type === 'promql') {
    const errorDetailValue = error?.response?.data?.error || error?.message;
    const trimmedErrorMessage =
      errorDetailValue?.length > 300
        ? errorDetailValue.slice(0, 300) + ' ...'
        : errorDetailValue;

    const errorCode =
      error?.response?.status ||
      error?.status ||
      error?.response?.data?.code ||
      '';

    return {
      message: trimmedErrorMessage,
      code: String(errorCode ?? ''),
    } as ErrorDetail;
  }

  // sql
  const errorDetailValue =
    error?.response?.data.error_detail ||
    error?.response?.data.message ||
    error?.error_detail ||
    error?.message ||
    error?.error;

  const trimmedErrorMessage =
    errorDetailValue?.length > 300
      ? errorDetailValue.slice(0, 300) + ' ...'
      : errorDetailValue;

  const isWsOrStreaming = opts?.isWebsocket || opts?.isStreaming;

  const errorCode = isWsOrStreaming
    ? error?.response?.status ||
      error?.status ||
      error?.response?.data?.code ||
      error?.code ||
      ''
    : error?.response?.status ||
      error?.response?.data?.code ||
      error?.status ||
      error?.code ||
      '';

  return {
    message: trimmedErrorMessage,
    code: String(errorCode ?? ''),
  } as ErrorDetail;
};
