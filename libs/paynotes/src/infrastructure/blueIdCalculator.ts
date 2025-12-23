import { Blue } from '@blue-labs/language';
import type { JsonValue } from '@blue-labs/shared-utils';
import { repository } from '@blue-repository/types';
import type { BlueIdCalculator } from '../application/ports';

const buildBlueRepository = () => {
  const packages = Object.values(repository.packages);

  const blueIds = packages.reduce<Record<string, string>>((acc, pkg) => {
    return { ...acc, ...pkg.aliases };
  }, {});

  const schemas = packages.flatMap(pkg => Object.values(pkg.schemas));

  const contents = packages.reduce<Record<string, JsonValue>>((acc, pkg) => {
    return { ...acc, ...pkg.contents };
  }, {});

  return {
    name: repository.name,
    repositoryVersions: repository.repositoryVersions,
    packages: repository.packages,
    blueIds,
    schemas,
    contents,
  };
};

const blue = new Blue({
  repositories: [buildBlueRepository()],
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
