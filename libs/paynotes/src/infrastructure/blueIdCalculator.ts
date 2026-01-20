import type { BlueIdCalculator } from '../application/ports';
import { blue } from '../blue';

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
