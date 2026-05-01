export const confirmAction = (message: string) => {
  if (typeof window === 'undefined') {
    return true;
  }

  return window.confirm(message);
};

export const formatActionError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
};
