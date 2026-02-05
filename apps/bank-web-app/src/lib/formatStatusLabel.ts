export const formatStatusLabel = (value?: string) => {
  if (!value) return 'Unknown';
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
};
