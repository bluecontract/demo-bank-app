import { createHmac } from 'crypto';
import type { CardHasher } from '../application/CardHasher';

export class HmacCardHasher implements CardHasher {
  constructor(
    private readonly panSecret: string,
    private readonly cvcSecret: string
  ) {}

  hashPan(pan: string): string {
    return createHmac('sha256', this.panSecret).update(pan).digest('hex');
  }

  hashCvc(cvc: string): string {
    return createHmac('sha256', this.cvcSecret).update(cvc).digest('hex');
  }
}
