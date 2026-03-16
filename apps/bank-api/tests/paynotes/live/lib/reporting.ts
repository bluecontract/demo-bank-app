import { randomUUID } from 'node:crypto';

export type ScenarioRunContext = {
  scenarioId: string;
  runId: string;
};

export function createScenarioRunContext(
  scenarioId: string
): ScenarioRunContext {
  const externalRunId =
    process.env.PAYNOTE_TEST_RUN_ID?.trim() ||
    process.env.PAYNOTE_E2E_RUN_ID?.trim();

  return {
    scenarioId,
    runId: externalRunId || `${scenarioId}-${randomUUID().slice(0, 8)}`,
  };
}

export function logScenarioStep(
  context: ScenarioRunContext,
  step: string,
  details?: Record<string, unknown>
) {
  console.log(
    JSON.stringify({
      scope: 'paynotes-test',
      scenarioId: context.scenarioId,
      runId: context.runId,
      step,
      ...(details ?? {}),
    })
  );
}
