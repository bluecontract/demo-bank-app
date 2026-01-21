import { describe, it, expect } from 'vitest';
import { BlueNode } from '@blue-labs/language';
import { blue } from '@demo-bank-app/shared-bank-api-contract';
import {
  buildPayload,
  buildRequestModel,
  type ValidationError,
} from './operationFormModel';

describe('operation form model', () => {
  it('builds field models for primitives and collections', () => {
    const requestNode = blue.jsonValueToNode({
      amount: { type: 'Integer' },
      note: { type: 'Text' },
      tags: { type: 'List', itemType: { type: 'Text' } },
      flags: { type: 'Dictionary', valueType: { type: 'Boolean' } },
    });
    requestNode.addProperty('extra', new BlueNode().setType('Unknown/Type'));

    const model = buildRequestModel(requestNode, blue, 'Request');

    expect(model.kind).toBe('object');
    expect(model.fields?.amount.kind).toBe('integer');
    expect(model.fields?.note.kind).toBe('text');
    expect(model.fields?.tags.kind).toBe('list');
    expect(model.fields?.flags.kind).toBe('dictionary');
    expect(model.fields?.extra.kind).toBe('raw');
  });

  it('validates missing and raw JSON values', () => {
    const requestNode = blue.jsonValueToNode({
      message: { type: 'Text' },
    });
    requestNode.addProperty('extra', new BlueNode().setType('Unknown/Type'));

    const model = buildRequestModel(requestNode, blue, 'Request');
    const result = buildPayload(model, {
      message: '',
      extra: '{not-json}',
    });

    const errorPaths = result.errors.map(
      (error: ValidationError) => error.path
    );
    expect(errorPaths).toContain('message');
    expect(errorPaths).toContain('extra');
  });

  it('builds timestamp fields and formats ISO output', () => {
    const requestNode = blue.jsonValueToNode({
      acceptedAt: { type: 'Common/Timestamp' },
    });

    const model = buildRequestModel(requestNode, blue, 'Request');
    expect(model.fields?.acceptedAt.kind).toBe('timestamp');

    const result = buildPayload(model, { acceptedAt: '2024-01-02T03:04' });
    const payload = result.payload as { acceptedAt?: string };

    expect(payload.acceptedAt).toMatch(/^2024-01-02T03:04:00[+-]\d{2}:\d{2}$/);
  });
});
