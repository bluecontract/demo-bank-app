type MerchantFrom = {
  merchantId?: string;
  name: string;
  logoUrl?: string;
};

type MerchantDirectoryMap = Record<string, MerchantFrom>;

type ItemWithMerchantFrom = {
  from: MerchantFrom;
};

export const hydrateMerchantLogos = <T extends ItemWithMerchantFrom>(
  items: T[],
  merchantDirectory?: MerchantDirectoryMap
): T[] => {
  if (!merchantDirectory || !Object.keys(merchantDirectory).length) {
    return items;
  }

  return items.map(item => {
    const merchantId = item.from?.merchantId;
    if (!merchantId) {
      return item;
    }

    const merchant = merchantDirectory[merchantId];
    if (!merchant?.logoUrl || item.from.logoUrl === merchant.logoUrl) {
      return item;
    }

    return {
      ...item,
      from: {
        ...item.from,
        logoUrl: merchant.logoUrl,
      },
    };
  });
};
