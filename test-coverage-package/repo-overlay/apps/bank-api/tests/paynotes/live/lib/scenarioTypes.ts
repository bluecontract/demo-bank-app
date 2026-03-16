export type PayNoteLayer = 'local-live' | 'real-myos-e2e';

export type PayNoteScenarioDefinition = {
  scenarioId: string;
  title: string;
  layer: PayNoteLayer;
  serial: boolean;
  covers: string[];
  sourceFixtures?: string[];
};
