import {
  advance,
  answerKey,
  currentNode,
  outline,
  returnFromReview,
  type Answer,
  type Flow,
  type LoopAssignment,
  type Node,
  type State,
  type Test,
} from '../../src/shared/flow';
import { rehearsalAnswerValid } from '../../src/shared/nodes/rehearsal';
export type Scenario = Record<string, Answer | null>;
export interface ScenarioStep {
  key: string;
  node: Node;
  number: string;
  occurrence: string;
  sample: string;
}
/** Enumerate candidate answer slots, without predicting a guard result or fabricating an answer. */
export function scenarioSteps(flow: Flow, assignments: LoopAssignment[]): ScenarioStep[] {
  const entries = outline(flow.nodes);
  const walk = (nodes: Node[], occurrence = 'study', sample = '—'): ScenarioStep[] =>
    nodes.flatMap((node) => {
      if (node.kind === 'end') return [];
      if (node.kind === 'group') return walk(node.data.children, occurrence, sample);
      if (node.kind === 'loop_samples')
        return (assignments.find((a) => a.loop_id === node.id)?.samples ?? []).flatMap((s) =>
          walk(node.data.children, node.id + ':' + s.sample_id, s.code),
        );
      return [
        {
          node,
          number: entries.find((e) => e.node.id === node.id)!.number,
          occurrence,
          sample,
          key: occurrence + ':' + node.id,
        },
      ];
    });
  return walk(flow.nodes);
}
export function stepScenario(flow: Flow, state: State, scenario: Scenario, tests: Test[]): State {
  if (state.outcome) return state;
  if (state.review) return returnFromReview(flow, state);
  const node = currentNode(flow, state);
  if (!node) throw new Error('No current scenario step.');
  const key = answerKey(state, node.id);
  if (!Object.hasOwn(scenario, key))
    throw new Error('Enter a scenario answer for the current occurrence.');
  const answer = scenario[key] ?? undefined;
  if (!rehearsalAnswerValid(node, answer, state.variables, tests))
    throw new Error('The scenario answer is invalid for the current occurrence.');
  return advance(flow, state, answer);
}
/** Bounded forward replay: errors retain the successfully evaluated prefix. */
export function runScenario(flow: Flow, state: State, scenario: Scenario, tests: Test[]) {
  let next = state;
  try {
    // At most 100 nodes × 50 samples; allow one review return per node.
    for (let i = 0; i < 10000 && !next.outcome; i++)
      next = stepScenario(flow, next, scenario, tests);
    if (!next.outcome) throw new Error('Scenario exceeded the bounded flow limit.');
    return { state: next, error: '' };
  } catch (e) {
    return { state: next, error: e instanceof Error ? e.message : 'Scenario failed.' };
  }
}
