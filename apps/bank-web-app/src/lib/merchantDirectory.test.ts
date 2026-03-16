import { describe, expect, it } from 'vitest';
import { hydrateMerchantLogos } from './merchantDirectory';

describe('hydrateMerchantLogos', () => {
  it('hydrates list items with logo URLs from the merchant directory map', () => {
    const items = [
      {
        id: 'item-1',
        from: {
          merchantId: 'merchant-1',
          name: 'Blue Appliances',
        },
      },
    ];

    const result = hydrateMerchantLogos(items, {
      'merchant-1': {
        merchantId: 'merchant-1',
        name: 'Blue Appliances',
        logoUrl: 'data:image/png;base64,abc',
      },
    });

    expect(result).toEqual([
      {
        id: 'item-1',
        from: {
          merchantId: 'merchant-1',
          name: 'Blue Appliances',
          logoUrl: 'data:image/png;base64,abc',
        },
      },
    ]);
  });

  it('leaves items unchanged when no merchant directory entry exists', () => {
    const items = [
      {
        id: 'item-1',
        from: {
          merchantId: 'merchant-1',
          name: 'Blue Appliances',
        },
      },
    ];

    expect(hydrateMerchantLogos(items, {})).toEqual(items);
  });
});
