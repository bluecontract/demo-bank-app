import { Blue } from '@blue-labs/language';
import { repository as coreRepository } from '@blue-repository/core-dev';
import { repository as myosRepository } from '@blue-repository/myos-dev';
import { repository as permissionRepository } from '@blue-repository/permission';
import { repository as paymentRepository } from '@blue-repository/payment';

const blue = new Blue({
  repositories: [
    coreRepository,
    myosRepository,
    permissionRepository,
    paymentRepository,
  ],
});

export const calculateBlueIdFromYaml = (yamlContent: string): string => {
  const node = blue.yamlToNode(yamlContent);
  return blue.calculateBlueIdSync(node);
};

export const calculateBlueIdFromObject = (
  payNote: Record<string, unknown>
): string => {
  const node = blue.jsonValueToNode(payNote);
  return blue.calculateBlueIdSync(node);
};
