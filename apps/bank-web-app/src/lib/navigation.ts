export const navigateTo = (target: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.location.assign(target);
};
