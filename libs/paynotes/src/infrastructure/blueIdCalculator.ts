import { Blue } from '@blue-labs/language';
import { repository as coreRepository } from '@blue-repository/core-dev';
import { repository as myosRepository } from '@blue-repository/myos-dev';
import { repository as payNoteRepository } from '@blue-repository/pay-note';
import type { BlueIdCalculator } from '../application/ports';

const blue = new Blue({
  repositories: [coreRepository, myosRepository, payNoteRepository],
});

export const createBlueIdCalculator = (): BlueIdCalculator => ({
  fromYaml(yamlContent) {
    const node = blue.yamlToNode(yamlContent);
    return blue.calculateBlueIdSync(node);
  },

  fromObject(payload) {
    const node = blue.jsonValueToNode(payload);
    return blue.calculateBlueIdSync(node);
  },

  toReversedJson(payload) {
    const node = blue.jsonValueToNode(payload);
    const reversedNode = blue.reverse(node);
    const restoredNode = blue.restoreInlineTypes(reversedNode);
    return blue.nodeToJson(restoredNode);
  },
});
