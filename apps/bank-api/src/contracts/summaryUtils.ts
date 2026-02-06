import { Blue, BlueNode, Properties } from '@blue-labs/language';
import {
  getTypeAliasByBlueId,
  repository as blueRepository,
} from '@blue-repository/types';

export class ContractSummaryInputError extends Error {
  override name = 'ContractSummaryInputError';
}

export const summaryBlue = new Blue({
  repositories: [blueRepository],
});

export const toBlueNode = (value: unknown): BlueNode | null => {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    return summaryBlue.jsonValueToNode(value);
  } catch {
    return null;
  }
};

export const stripResolvedTypeNodes = (node: BlueNode): BlueNode => {
  const stripType = (typeNode: BlueNode | undefined): BlueNode | undefined => {
    if (!typeNode) {
      return undefined;
    }
    const blueId = typeNode.getBlueId();
    if (!blueId) {
      return typeNode;
    }
    return new BlueNode().setBlueId(blueId);
  };

  const visit = (current: BlueNode) => {
    current.setType(stripType(current.getType()));
    current.setItemType(stripType(current.getItemType()));
    current.setKeyType(stripType(current.getKeyType()));
    current.setValueType(stripType(current.getValueType()));

    const properties = current.getProperties();
    if (properties) {
      Object.values(properties).forEach(visit);
    }

    const items = current.getItems();
    if (items) {
      items.forEach(visit);
    }
  };

  const cloned = node.clone();
  visit(cloned);
  return cloned;
};

type BlueIdStub = { blueId: string; path: string };
export const findNonTypeBlueIdStubs = (
  value: unknown,
  options?: {
    parentKey?: string;
    path?: string[];
    ignoredStubKeys?: Set<string>;
  }
): BlueIdStub[] => {
  const parentKey = options?.parentKey;
  const path = options?.path ?? [];
  const ignoredStubKeys = options?.ignoredStubKeys;
  const stubs: BlueIdStub[] = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      stubs.push(
        ...findNonTypeBlueIdStubs(item, {
          parentKey: undefined,
          path: [...path, String(index)],
          ignoredStubKeys,
        })
      );
    });
    return stubs;
  }

  if (!value || typeof value !== 'object') {
    return stubs;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const isBlueIdOnly =
    keys.length === 1 &&
    keys[0] === 'blueId' &&
    typeof record.blueId === 'string';

  const isTypeContext =
    parentKey === 'type' ||
    parentKey === 'itemType' ||
    parentKey === 'keyType' ||
    parentKey === 'valueType';

  if (isBlueIdOnly && !isTypeContext) {
    if (parentKey && ignoredStubKeys?.has(parentKey)) {
      return stubs;
    }
    stubs.push({ blueId: record.blueId as string, path: '/' + path.join('/') });
    return stubs;
  }

  for (const [key, child] of Object.entries(record)) {
    stubs.push(
      ...findNonTypeBlueIdStubs(child, {
        parentKey: key,
        path: [...path, key],
        ignoredStubKeys,
      })
    );
  }

  return stubs;
};

export const resolveContractsForSummary = (documentNode: BlueNode) => {
  let contracts: Record<string, BlueNode> = {};
  try {
    const contractsOnlyNode = new BlueNode()
      .setType(documentNode.getType()?.clone())
      .setContracts(documentNode.getContracts() ?? {});
    const resolved = summaryBlue.resolve(contractsOnlyNode);
    contracts = resolved.getContracts() ?? {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContractSummaryInputError(
      `Failed to resolve contracts for summary generation: ${message}`
    );
  }

  if (!Object.keys(contracts).length) {
    return {};
  }

  const container = new BlueNode().setContracts(contracts);
  const stripped = stripResolvedTypeNodes(container);
  let json: Record<string, unknown> | undefined;
  try {
    json = summaryBlue.nodeToJson(stripped, 'simple') as
      | Record<string, unknown>
      | undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContractSummaryInputError(
      `Unable to serialize resolved contracts to JSON: ${message}`
    );
  }

  const contractsJson = json?.contracts;
  if (!contractsJson) {
    return {};
  }
  if (typeof contractsJson !== 'object') {
    throw new ContractSummaryInputError(
      'Resolved contracts map is not an object.'
    );
  }

  const stubs = findNonTypeBlueIdStubs(contractsJson, { path: ['contracts'] });
  if (stubs.length) {
    throw new ContractSummaryInputError(
      `Contract contracts contain non-type {blueId} references which cannot be sent to the LLM: ${stubs
        .slice(0, 5)
        .map(s => `${s.blueId} @ ${s.path}`)
        .join(', ')}${stubs.length > 5 ? ` (+${stubs.length - 5} more)` : ''}`
    );
  }

  return contractsJson as Record<string, unknown>;
};

export const collectTypeBlueIdsFromNode = (
  node: BlueNode,
  sink: Set<string>
) => {
  const visit = (current: BlueNode) => {
    const typeIds = [
      current.getType()?.getBlueId(),
      current.getItemType()?.getBlueId(),
      current.getKeyType()?.getBlueId(),
      current.getValueType()?.getBlueId(),
    ];
    typeIds.forEach(id => {
      if (id) {
        sink.add(id);
      }
    });

    const properties = current.getProperties();
    if (properties) {
      Object.values(properties).forEach(visit);
    }
    const items = current.getItems();
    if (items) {
      items.forEach(visit);
    }
  };

  visit(node);
};

export const collectTypeBlueIdsFromJson = (
  value: unknown,
  sink: Set<string>
) => {
  if (Array.isArray(value)) {
    value.forEach(item => collectTypeBlueIdsFromJson(item, sink));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  const collectTypeField = (field: unknown) => {
    if (!field || typeof field !== 'object') return;
    const blueId = (field as Record<string, unknown>).blueId;
    if (typeof blueId === 'string') {
      sink.add(blueId);
    }
  };

  collectTypeField(record.type);
  collectTypeField(record.itemType);
  collectTypeField(record.keyType);
  collectTypeField(record.valueType);

  Object.values(record).forEach(child =>
    collectTypeBlueIdsFromJson(child, sink)
  );
};

export const buildTypeDefinitionPack = (seedTypeBlueIds: Set<string>) => {
  const allTypeContentsByBlueId: Record<string, unknown> = {};
  for (const pkg of Object.values(blueRepository.packages)) {
    Object.assign(allTypeContentsByBlueId, pkg.contents);
  }

  const definitionsByBlueId: Record<string, unknown> = {};
  const typeNameByBlueId: Record<string, string> = {};

  const queue: string[] = Array.from(seedTypeBlueIds);
  const seen = new Set<string>();

  while (queue.length) {
    const blueId = queue.shift();
    if (!blueId || seen.has(blueId)) {
      continue;
    }
    seen.add(blueId);

    const alias = getTypeAliasByBlueId(blueId);
    if (alias) {
      typeNameByBlueId[blueId] = alias;
    }

    const content = allTypeContentsByBlueId[blueId];
    if (!content) {
      // Built-in core types are referenced by blueId but do not have repository content.
      if (blueId in Properties.CORE_TYPE_BLUE_ID_TO_NAME_MAP) {
        definitionsByBlueId[blueId] = {
          name: Properties.CORE_TYPE_BLUE_ID_TO_NAME_MAP[
            blueId as keyof typeof Properties.CORE_TYPE_BLUE_ID_TO_NAME_MAP
          ],
          description: 'Built-in core type.',
        };
        continue;
      }

      throw new ContractSummaryInputError(
        `Missing type definition for blueId ${blueId} (not found in @blue-repository/types).`
      );
    }

    definitionsByBlueId[blueId] = content;

    const nestedTypeIds = new Set<string>();
    collectTypeBlueIdsFromJson(content, nestedTypeIds);
    nestedTypeIds.forEach(id => {
      if (!seen.has(id)) {
        queue.push(id);
      }
    });
  }

  return { definitionsByBlueId, typeNameByBlueId };
};

export const isOpenAiContextLimitError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (code === 'context_length_exceeded') {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes('context length') ||
    normalized.includes('maximum context length') ||
    normalized.includes('context window')
  );
};
