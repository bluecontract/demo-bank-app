import type {
  MerchantDirectoryEntry,
  MerchantDirectoryRepository,
} from '@demo-bank-app/auth';

export type MerchantFrom = {
  merchantId?: string;
  name: string;
  logoUrl?: string;
};

const DEFAULT_NAME = 'Merchant';

export const buildMerchantDirectoryMap = async (
  merchantIds: Array<string | undefined>,
  repository: MerchantDirectoryRepository
): Promise<Map<string, MerchantDirectoryEntry>> => {
  const uniqueIds = Array.from(
    new Set(merchantIds.filter((id): id is string => Boolean(id)))
  );

  if (!uniqueIds.length) {
    return new Map();
  }

  const entries = await repository.getMerchantsByIds(uniqueIds);
  return new Map(entries.map(entry => [entry.merchantId, entry]));
};

export const resolveMerchantFrom = (
  merchantId: string | undefined,
  directory: Map<string, MerchantDirectoryEntry>
): MerchantFrom => {
  if (!merchantId) {
    return { name: DEFAULT_NAME };
  }

  const entry = directory.get(merchantId);
  if (!entry) {
    return { name: DEFAULT_NAME };
  }

  return {
    merchantId: entry.merchantId,
    name: entry.name,
    logoUrl: entry.logoUrl,
  };
};
