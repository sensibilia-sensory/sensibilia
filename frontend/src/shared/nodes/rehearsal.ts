import { previewAssignment } from '../../methods';
import type { NewConfiguration } from '../../api';
import type { components } from '../../api-schema';
import {
  assignmentsFor,
  linearIssues,
  outline,
  type Flow,
  type Sample,
  type Test,
  type Value,
  type Answer,
  type Node,
} from '../flow';
import { answersValid, type Configuration } from '../methods/hedonic_acceptance_9/validation';
import {
  registeredMethods,
  methodValuesValid,
  configurationErrors as methodErrors,
  type Configuration as MethodConfiguration,
} from '../methods/registry';
import { temporalValid } from '../methods/temporal';
import { answerValid, codeAnswer } from './answers';

export function rehearsalPackage(
  flow: Flow,
  tests: Test[],
  samples: Sample[],
  designs: components['schemas']['DesignRead'][] = [],
  sequenceIndex = 0,
) {
  const issues = linearIssues(flow, tests);
  for (const test of tests) {
    if (!registeredMethods.has(test.test_type_id))
      issues.push('This method renderer is unavailable.');
    else if (Object.keys(methodErrors(test.configuration as MethodConfiguration)).length)
      issues.push('Method configuration is invalid.');
  }
  for (const { node } of outline(flow.nodes))
    if (node.kind === 'embedded_method' && !tests.some((t) => t.id === node.data.study_test_id))
      issues.push('Referenced method is missing.');
  let assignments: ReturnType<typeof assignmentsFor> = [];
  try {
    assignments = assignmentsFor(flow, samples, designs, sequenceIndex);
  } catch (e) {
    issues.push(e instanceof Error ? e.message : 'Missing samples');
  }
  const methodAssignments = tests
    .filter((t) => t.test_type_id !== 'hedonic-9-v1')
    .map((t) => ({
      ...previewAssignment(t.configuration as NewConfiguration, samples),
      study_test_id: t.id,
    }));
  return { issues, assignments, methodAssignments };
}
export async function rehearsalContext(
  flow: Flow,
  returning: string,
  booth: string,
  table: string,
) {
  if ([booth, table].some((v) => v !== '' && (!v.trim() || !Number.isSafeInteger(Number(v)))))
    throw new Error('Booth/table numbers must be integers.');
  const normalizations = outline(flow.nodes).flatMap((e) =>
    e.node.kind === 'code_entry' ? [e.node.data.normalization] : [],
  );
  const hashes = await Promise.all(
    returning
      .split(',')
      .filter((v) => v.trim())
      .flatMap((value) =>
        [...new Set(normalizations)].map((normalization) =>
          codeAnswer(value, normalization).then((a) => a.code_hash),
        ),
      ),
  );
  const context: Record<string, Value> = { 'context.returning_code_hashes': [...new Set(hashes)] };
  if (booth !== '') context['context.booth_number'] = Number(booth);
  if (table !== '') context['context.table_number'] = Number(table);
  return context;
}
export function configurationFor(node: Node, tests: Test[]) {
  const test =
    node.kind === 'embedded_method'
      ? tests.find((t) => t.id === node.data.study_test_id)
      : undefined;
  return test?.test_type_id === 'hedonic-9-v1' ? (test.configuration as Configuration) : undefined;
}
export function rehearsalAnswerValid(
  node: Node,
  answer: Answer | undefined,
  variables: Record<string, Value>,
  tests: Test[],
) {
  const method =
    node.kind === 'embedded_method'
      ? tests.find((t) => t.id === node.data.study_test_id)
      : undefined;
  if (method?.test_type_id === 'tcata-v1')
    return (
      answer?.state === 'temporal' &&
      answer.ready &&
      answer.value.state !== 'running' &&
      temporalValid(method.configuration as import('../methods/temporal').TemporalConfig, {
        ...answer.value,
        state: answer.value.state,
      })
    );
  if (method && method.test_type_id !== 'hedonic-9-v1')
    return (
      answer?.state === 'method_values' &&
      answer.ready &&
      methodValuesValid(method.configuration as NewConfiguration, answer.answers)
    );
  const config = configurationFor(node, tests);
  return config
    ? (answer === undefined || answer.state === 'method') &&
        answersValid(config, answer?.state === 'method' ? answer.answers : {})
    : answerValid(node, answer, variables);
}
