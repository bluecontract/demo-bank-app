export interface MerchantIdentityResolver {
  resolveMerchantUserId(
    merchantId: string,
    options?: { signal?: AbortSignal }
  ): Promise<string>;
}

export const createIdentityMerchantIdentityResolver =
  (): MerchantIdentityResolver => ({
    async resolveMerchantUserId(merchantId: string) {
      return merchantId;
    },
  });
