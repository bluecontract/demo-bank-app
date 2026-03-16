import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readDocumentFixture(fileName: string) {
  const path = join(__dirname, '..', 'fixtures', 'documents', fileName);
  return readFileSync(path, 'utf-8');
}
