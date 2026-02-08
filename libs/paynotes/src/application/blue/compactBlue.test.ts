import { describe, expect, it } from 'vitest';
import { BlueNode } from '@blue-labs/language';
import { blueIds } from '@blue-repository/types/packages/paynote/blue-ids';
import { blue } from '../../blue';
import {
  stripResolvedTypeRefsToBlueId,
  toCompactBlueJsonValue,
} from './compactBlue';

const TYPE_BLUE_ID = blueIds['PayNote/PayNote'];
const ITEM_BLUE_ID = blueIds['PayNote/PayNote Delivery'];
const VALUE_TYPE_BLUE_ID = blueIds['PayNote/Card Transaction PayNote'];

describe('compactBlue', () => {
  it('strips resolved type definitions to blueId-only without mutating original', () => {
    const resolvedType = new BlueNode()
      .setBlueId(TYPE_BLUE_ID)
      .setName('Resolved Type')
      .addProperty('details', new BlueNode().setValue('expanded'));

    const source = new BlueNode()
      .setType(resolvedType)
      .setItemType(new BlueNode().setBlueId(ITEM_BLUE_ID).setName('List Item'))
      .setValueType(
        new BlueNode().setBlueId(VALUE_TYPE_BLUE_ID).setName('Value Type')
      )
      .addProperty(
        'nested',
        new BlueNode().setType(resolvedType.clone()).setValue('payload')
      );

    const compact = stripResolvedTypeRefsToBlueId(source);

    expect(source.getType()?.getName()).toBe('Resolved Type');
    expect(source.getType()?.getProperties()).toBeDefined();
    expect(compact.getType()?.getBlueId()).toBe(TYPE_BLUE_ID);
    expect(compact.getType()?.getName()).toBeUndefined();
    expect(compact.getType()?.getProperties()).toBeUndefined();
    expect(compact.getItemType()?.getBlueId()).toBe(ITEM_BLUE_ID);
    expect(compact.getItemType()?.getName()).toBeUndefined();
    expect(compact.getValueType()?.getBlueId()).toBe(VALUE_TYPE_BLUE_ID);
    expect(compact.getValueType()?.getName()).toBeUndefined();
    expect(compact.getProperties()?.nested?.getType()?.getBlueId()).toBe(
      TYPE_BLUE_ID
    );
    expect(
      compact.getProperties()?.nested?.getType()?.getName()
    ).toBeUndefined();
  });

  it('converts JSON payload to compact original representation', () => {
    const resolvedType = new BlueNode()
      .setBlueId(TYPE_BLUE_ID)
      .setName('Resolved Type')
      .addProperty('details', new BlueNode().setValue('expanded'));

    const payloadNode = new BlueNode()
      .setType(resolvedType)
      .addProperty(
        'nested',
        new BlueNode().setType(resolvedType.clone()).setValue('payload')
      );

    const payload = blue.nodeToJson(payloadNode, 'official');
    const compact = toCompactBlueJsonValue(payload);
    const compactNode = blue.jsonValueToNode(compact);

    expect(compactNode.getType()?.getBlueId()).toBe(TYPE_BLUE_ID);
    expect(compactNode.getType()?.getName()).toBeUndefined();
    expect(compactNode.getType()?.getProperties()).toBeUndefined();
    expect(compactNode.getProperties()?.nested?.getType()?.getBlueId()).toBe(
      TYPE_BLUE_ID
    );
    expect(
      compactNode.getProperties()?.nested?.getType()?.getProperties()
    ).toBeUndefined();
  });

  it('returns unchanged value when compaction cannot parse input', () => {
    const value = { type: Symbol('invalid') };
    expect(toCompactBlueJsonValue(value)).toBe(value);
  });
});
