export interface CardHasher {
  hashPan(pan: string): string;
  hashCvc(cvc: string): string;
}
