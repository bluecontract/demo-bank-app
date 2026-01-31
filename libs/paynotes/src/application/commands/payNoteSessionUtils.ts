export const mergeSessionIds = (
  existing: string[] | undefined,
  next: string[] | string | undefined
): string[] | undefined => {
  const incoming = Array.isArray(next) ? next : next ? [next] : [];
  if (!incoming.length) {
    return existing;
  }
  const set = new Set(existing ?? []);
  incoming.forEach(id => {
    if (id) {
      set.add(id);
    }
  });
  return Array.from(set);
};
