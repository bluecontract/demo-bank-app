import { Blue } from '@blue-labs/language';
import { repository } from '@blue-repository/types';
import { createDefaultMergingProcessor } from '@blue-labs/document-processor';

export const blue = new Blue({
  repositories: [repository],
  mergingProcessor: createDefaultMergingProcessor(),
});
