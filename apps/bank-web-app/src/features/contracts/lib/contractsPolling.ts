const POLLING_INTERVAL_MS = 5000;

export const getContractsPollingInterval = (): number | false => {
  const disablePolling = __UI_REFRESH_DISABLE_POLLING__ === 'true';
  return disablePolling ? false : POLLING_INTERVAL_MS;
};
