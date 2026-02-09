import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML, { isMap, isSeq } from 'yaml';

import { renderDatadogTemplate } from './render-datadog-template.mjs';

function readBaseTemplate(): string {
  return readFileSync(new URL('../template.yaml', import.meta.url), 'utf8');
}

function parseDocument(source: string) {
  const doc = YAML.parseDocument(source);
  expect(doc.errors).toHaveLength(0);
  return doc;
}

function countDatadogSecretStatements(
  doc: YAML.Document.Parsed,
  functionResourceName: string
): number {
  const policies = doc.getIn(
    ['Resources', functionResourceName, 'Properties', 'Policies'],
    true
  );
  if (!policies || !isSeq(policies)) {
    return 0;
  }

  const inlinePolicy = policies.items.find(
    policyItem => isMap(policyItem) && policyItem.has('Statement')
  );
  if (!inlinePolicy || !isMap(inlinePolicy)) {
    return 0;
  }

  const statements = inlinePolicy.get('Statement', true);
  if (!statements || !isSeq(statements)) {
    return 0;
  }

  return statements.items.filter(statementItem => {
    if (!isMap(statementItem)) {
      return false;
    }

    return (
      statementItem.getIn(['Resource', 'Ref']) === 'DatadogApiKeySecretArn'
    );
  }).length;
}

describe('renderDatadogTemplate', () => {
  it('should inject Datadog transform, parameters, env vars, and policies', () => {
    const output = renderDatadogTemplate(readBaseTemplate());
    const doc = parseDocument(output);

    const transform = doc.get('Transform', true);
    expect(transform && isSeq(transform)).toBe(true);
    expect(doc.getIn(['Transform', 1, 'Name'])).toBe('DatadogServerless');
    expect(
      doc.getIn(['Transform', 1, 'Parameters', 'nodeLayerVersion', 'Ref'])
    ).toBe('DatadogNodeLayerVersion');
    expect(
      doc.getIn(['Transform', 1, 'Parameters', 'extensionLayerVersion', 'Ref'])
    ).toBe('DatadogExtensionLayerVersion');

    expect(doc.getIn(['Parameters', 'DatadogApiKeySecretArn', 'Type'])).toBe(
      'String'
    );
    expect(doc.getIn(['Parameters', 'DDVersion', 'Default'])).toBe('unknown');
    expect(doc.getIn(['Parameters', 'DatadogNodeLayerVersion', 'Type'])).toBe(
      'Number'
    );
    expect(
      doc.getIn(['Parameters', 'DatadogNodeLayerVersion', 'Default'])
    ).toBe(127);
    expect(
      doc.getIn(['Parameters', 'DatadogExtensionLayerVersion', 'Type'])
    ).toBe('Number');
    expect(
      doc.getIn(['Parameters', 'DatadogExtensionLayerVersion', 'Default'])
    ).toBe(88);

    expect(
      doc.getIn([
        'Globals',
        'Function',
        'Environment',
        'Variables',
        'DD_ENV',
        'Ref',
      ])
    ).toBe('Environment');
    expect(
      doc.getIn([
        'Globals',
        'Function',
        'Environment',
        'Variables',
        'DD_TRACE_ENABLED',
        'Ref',
      ])
    ).toBe('DatadogTraceEnabled');

    expect(
      doc.getIn([
        'Resources',
        'BankLambdaFunction',
        'Properties',
        'Environment',
        'Variables',
        'DD_SERVICE',
      ])
    ).toBe('bank-api');
    expect(
      doc.getIn([
        'Resources',
        'SummaryLambdaFunction',
        'Properties',
        'Environment',
        'Variables',
        'DD_SERVICE',
      ])
    ).toBe('bank-api-summary');

    expect(countDatadogSecretStatements(doc, 'BankLambdaFunction')).toBe(1);
    expect(countDatadogSecretStatements(doc, 'SummaryLambdaFunction')).toBe(1);
  });

  it('should remain idempotent when run multiple times', () => {
    const firstPass = renderDatadogTemplate(readBaseTemplate());
    const secondPass = renderDatadogTemplate(firstPass);

    const doc = parseDocument(secondPass);

    expect(doc.getIn(['Transform', 1, 'Name'])).toBe('DatadogServerless');
    expect(countDatadogSecretStatements(doc, 'BankLambdaFunction')).toBe(1);
    expect(countDatadogSecretStatements(doc, 'SummaryLambdaFunction')).toBe(1);
  });
});
