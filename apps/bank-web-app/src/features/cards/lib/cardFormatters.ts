export const formatCardExpiry = (month: number, year: number) => {
  const monthValue = month.toString().padStart(2, '0');
  const shortYear = year.toString().slice(-2);
  return `${monthValue}/${shortYear}`;
};

export const formatCardStatus = (status: string) =>
  `${status.slice(0, 1)}${status.slice(1).toLowerCase()}`;
