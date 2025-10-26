import { Blue } from '@blue-labs/language';
import { repository as coreRepository } from '@blue-repository/core-dev';
import { repository as myosRepository } from '@blue-repository/myos-dev';
import { repository as payNoteRepository } from '@blue-repository/pay-note';

const blue = new Blue({
  repositories: [coreRepository, myosRepository, payNoteRepository],
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

export const toReversedJson = (
  payNote: Record<string, unknown>
): Record<string, unknown> => {
  const paynoteNode = blue.jsonValueToNode(payNote);
  const reversedNode = blue.reverse(paynoteNode);
  const restoredNode = blue.restoreInlineTypes(reversedNode);
  return blue.nodeToJson(restoredNode) as Record<string, unknown>;
};
