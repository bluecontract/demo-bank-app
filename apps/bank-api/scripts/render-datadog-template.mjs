#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import YAML, { isMap, isSeq } from 'yaml';

const DATADOG_SECRET_REF = 'DatadogApiKeySecretArn';

const DATADOG_TRANSFORM = [
  'AWS::Serverless-2016-10-31',
  {
    Name: 'DatadogServerless',
    Parameters: {
      addExtension: true,
      stackName: { Ref: 'AWS::StackName' },
      version: { Ref: 'DDVersion' },
      site: { Ref: 'DatadogSite' },
      nodeLayerVersion: { Ref: 'DatadogNodeLayerVersion' },
      extensionLayerVersion: { Ref: 'DatadogExtensionLayerVersion' },
      apiKeySecretArn: { Ref: DATADOG_SECRET_REF },
      enableXrayTracing: { Ref: 'DatadogTraceEnabled' },
    },
  },
];

const DATADOG_PARAMETERS = {
  DDVersion: {
    Type: 'String',
    Default: 'unknown',
  },
  DatadogApiKeySecretArn: {
    Type: 'String',
    Default: '',
  },
  DatadogSite: {
    Type: 'String',
    Default: 'datadoghq.eu',
  },
  DatadogNodeLayerVersion: {
    Type: 'Number',
    Default: 127,
  },
  DatadogExtensionLayerVersion: {
    Type: 'Number',
    Default: 88,
  },
  DatadogTraceEnabled: {
    Type: 'String',
    Default: 'true',
  },
  DatadogApmEnabled: {
    Type: 'String',
    Default: 'true',
  },
  DatadogTraceSamplingRules: {
    Type: 'String',
    Default: '[{"sample_rate":0.1}]',
  },
  DatadogLogLevel: {
    Type: 'String',
    Default: 'INFO',
  },
  DatadogFlushToLog: {
    Type: 'String',
    Default: 'false',
  },
  DatadogLogsInjection: {
    Type: 'String',
    Default: 'true',
  },
  DatadogCaptureLambdaPayload: {
    Type: 'String',
    Default: 'false',
  },
  DatadogEnhancedMetrics: {
    Type: 'String',
    Default: 'true',
  },
  DatadogServerlessLogsEnabled: {
    Type: 'String',
    Default: 'true',
  },
};

const DATADOG_GLOBAL_ENV = {
  DD_ENV: { Ref: 'Environment' },
  DD_VERSION: { Ref: 'DDVersion' },
  DD_API_KEY_SECRET_ARN: { Ref: DATADOG_SECRET_REF },
  DD_TRACE_ENABLED: { Ref: 'DatadogTraceEnabled' },
  DD_APM_ENABLED: { Ref: 'DatadogApmEnabled' },
  DD_TRACE_SAMPLING_RULES: { Ref: 'DatadogTraceSamplingRules' },
  DD_LOG_LEVEL: { Ref: 'DatadogLogLevel' },
  DD_SITE: { Ref: 'DatadogSite' },
  DD_ENHANCED_METRICS: { Ref: 'DatadogEnhancedMetrics' },
  DD_CAPTURE_LAMBDA_PAYLOAD: { Ref: 'DatadogCaptureLambdaPayload' },
  DD_SERVERLESS_LOGS_ENABLED: { Ref: 'DatadogServerlessLogsEnabled' },
  DD_FLUSH_TO_LOG: { Ref: 'DatadogFlushToLog' },
  DD_LOGS_INJECTION: { Ref: 'DatadogLogsInjection' },
};

function getArg(name, fallback = '') {
  const args = process.argv.slice(2);
  const index = args.findIndex(value => value === name);
  if (index === -1) {
    return fallback;
  }

  return args[index + 1] ?? fallback;
}

function ensureYamlMap(doc, path, label) {
  const node = doc.getIn(path, true);
  if (!node || !isMap(node)) {
    throw new Error(`Missing YAML map at ${label} (${path.join(' -> ')})`);
  }

  return node;
}

function ensureYamlSeq(doc, path, label) {
  const node = doc.getIn(path, true);
  if (!node || !isSeq(node)) {
    throw new Error(`Missing YAML sequence at ${label} (${path.join(' -> ')})`);
  }

  return node;
}

function setMapValues(targetMap, values) {
  for (const [key, value] of Object.entries(values)) {
    targetMap.set(key, value);
  }
}

function hasDatadogSecretStatement(statementSequence) {
  const toScalarValue = value =>
    value && typeof value === 'object' && 'value' in value
      ? value.value
      : value;

  return statementSequence.items.some(item => {
    if (!isMap(item)) {
      return false;
    }

    const resourceRef = toScalarValue(item.getIn(['Resource', 'Ref']));
    if (resourceRef !== DATADOG_SECRET_REF) {
      return false;
    }

    const action = item.get('Action', true);
    if (isSeq(action)) {
      return action.items.some(
        actionItem =>
          toScalarValue(actionItem) === 'secretsmanager:GetSecretValue'
      );
    }

    return toScalarValue(action) === 'secretsmanager:GetSecretValue';
  });
}

function ensureDatadogSecretStatement(doc, functionResourceName) {
  const policies = ensureYamlSeq(
    doc,
    ['Resources', functionResourceName, 'Properties', 'Policies'],
    `${functionResourceName} policies`
  );

  const inlinePolicy = policies.items.find(
    policyItem => isMap(policyItem) && policyItem.has('Statement')
  );

  if (!inlinePolicy || !isMap(inlinePolicy)) {
    throw new Error(
      `Missing inline policy Statement in ${functionResourceName}`
    );
  }

  const statements = inlinePolicy.get('Statement', true);
  if (!isSeq(statements)) {
    throw new Error(
      `Missing Statement sequence in ${functionResourceName} inline policy`
    );
  }

  if (hasDatadogSecretStatement(statements)) {
    return;
  }

  statements.add({
    Effect: 'Allow',
    Action: ['secretsmanager:GetSecretValue'],
    Resource: { Ref: DATADOG_SECRET_REF },
  });
}

export function renderDatadogTemplate(templateSource) {
  const doc = YAML.parseDocument(templateSource);

  if (doc.errors.length > 0) {
    const [firstError] = doc.errors;
    throw new Error(`Invalid template YAML: ${firstError.message}`);
  }

  doc.set('Transform', DATADOG_TRANSFORM);

  const parameters = ensureYamlMap(doc, ['Parameters'], 'Parameters');
  setMapValues(parameters, DATADOG_PARAMETERS);

  const globalVariables = ensureYamlMap(
    doc,
    ['Globals', 'Function', 'Environment', 'Variables'],
    'Globals.Function.Environment.Variables'
  );
  setMapValues(globalVariables, DATADOG_GLOBAL_ENV);

  const bankFunctionVariables = ensureYamlMap(
    doc,
    [
      'Resources',
      'BankLambdaFunction',
      'Properties',
      'Environment',
      'Variables',
    ],
    'BankLambdaFunction environment variables'
  );
  bankFunctionVariables.set('DD_SERVICE', 'bank-api');

  const summaryFunctionVariables = ensureYamlMap(
    doc,
    [
      'Resources',
      'SummaryLambdaFunction',
      'Properties',
      'Environment',
      'Variables',
    ],
    'SummaryLambdaFunction environment variables'
  );
  summaryFunctionVariables.set('DD_SERVICE', 'bank-api-summary');

  ensureDatadogSecretStatement(doc, 'BankLambdaFunction');
  ensureDatadogSecretStatement(doc, 'SummaryLambdaFunction');

  return doc.toString();
}

function runCli() {
  const inputPath = getArg('--input', './template.yaml');
  const outputPath = getArg('--output', './template.datadog.yaml');

  const source = readFileSync(inputPath, 'utf8');
  const renderedTemplate = renderDatadogTemplate(source);

  writeFileSync(outputPath, renderedTemplate, 'utf8');
  console.log(`Rendered Datadog template: ${outputPath}`);
}

const entrypointPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : '';
if (import.meta.url === entrypointPath) {
  runCli();
}
