import { randomUUID } from 'crypto';
import type { IdGeneratorPort } from '../application/ports';

export const createRandomIdGenerator = (): IdGeneratorPort => ({
  generate: () => randomUUID(),
});
