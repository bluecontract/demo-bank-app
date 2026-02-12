export const mergeUniqueStrings = (
  existing?: string[],
  incoming?: string[]
): string[] | undefined => {
  const set = new Set<string>(existing ?? []);
  (incoming ?? []).forEach(value => {
    if (value) {
      set.add(value);
    }
  });
  return set.size ? Array.from(set) : undefined;
};
