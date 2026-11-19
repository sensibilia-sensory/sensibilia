import { useCallback, useMemo } from 'react';
import type { components } from '../../api-schema';
import type { NewConfiguration, PreviewObservation, PublicAssignment } from '../../api';
import { MethodRenderer } from '../../MethodRenderer';
import { methodAssignment } from '../methods/registry';
import { TemporalRenderer } from './TemporalRenderer';
import type { TemporalDraft } from '../methods/temporal';
import { ServingGate } from './ServingGate';
import type { Answer, Node, Test, Flow, Value } from '../flow';
import { HedonicRenderer } from '../methods/hedonic_acceptance_9';
import { OrdinaryRenderer } from './OrdinaryRenderer';
import { localizedConfiguration } from '../flow/text';
import { configurationFor } from './rehearsal';
const noVariables: Record<string, Value> = {};
const noAssignments: components['schemas']['PublicAssignment'][] = [];
/** The controlled answer surface shared by Preview and the assessor. */
export function NodeAnswerRenderer({
  node,
  tests,
  assignments = noAssignments,
  language,
  flow,
  variables = noVariables,
  answer,
  onChange,
  disabled = false,
  temporalDraft,
  persistTemporal,
}: {
  temporalDraft?: TemporalDraft;
  persistTemporal?: (draft: TemporalDraft) => Promise<void>;
  node: Node;
  tests: Test[];
  assignments?: components['schemas']['PublicAssignment'][];
  language: string;
  flow?: Flow;
  variables?: Record<string, Value>;
  answer?: Answer;
  onChange: (answer: Answer | undefined) => void;
  disabled?: boolean;
}) {
  const test =
    node.kind === 'embedded_method'
      ? tests.find((t) => t.id === node.data.study_test_id)
      : undefined;
  const registered =
    test && test.test_type_id !== 'hedonic-9-v1'
      ? (test.configuration as NewConfiguration)
      : undefined;
  const localized = useMemo(
    () =>
      registered
        ? localizedConfiguration(
            registered,
            flow?.method_text?.[test!.id],
            language,
            variables,
            flow?.text_version === 1,
          )
        : undefined,
    [registered, flow, language, variables, test],
  );
  const assignment = useMemo(
    () =>
      registered
        ? methodAssignment(
            registered,
            variables,
            assignments.find((a) => a.study_test_id === test!.id) as PublicAssignment | undefined,
          )
        : undefined,
    [registered, variables, assignments, test],
  );
  const change = useCallback(
    (events: PreviewObservation[], ready: boolean) =>
      onChange({
        state: 'method_values',
        answers: Object.fromEntries(events.map((e) => [e.question_id, e.value])),
        ready,
      }),
    [onChange],
  );
  const initial = useMemo(
    () =>
      answer?.state === 'method_values'
        ? Object.entries(answer.answers).map(([question_id, value]) => ({
            question_id,
            value,
            sample_id: null,
          }))
        : [],
    [],
  );
  if (registered?.kind === 'tcata' && localized?.kind === 'tcata')
    return (
      <TemporalRenderer
        config={localized}
        initial={temporalDraft ?? (answer?.state === 'temporal' ? answer.value : undefined)}
        onChange={onChange}
        persist={persistTemporal}
        disabled={disabled}
      />
    );
  if (registered && localized && assignment)
    return (
      <MethodRenderer
        configuration={localized as NewConfiguration}
        assignment={assignment}
        change={change}
        initial={initial}
        disabled={disabled}
        layout={node.kind === 'embedded_method' ? (node.data.scale_layout ?? undefined) : undefined}
      />
    );
  if (node.kind === 'serve_gate')
    return (
      <ServingGate
        node={node}
        language={language}
        variables={variables}
        onChange={onChange}
        disabled={disabled}
      />
    );
  const config = configurationFor(node, tests);
  const answers = answer?.state === 'method' ? answer.answers : {};
  return config ? (
    <HedonicRenderer
      configuration={localizedConfiguration(
        config,
        flow?.method_text?.[node.kind === 'embedded_method' ? node.data.study_test_id : ''],
        language,
        variables,
        flow?.text_version === 1,
      )}
      answers={answers}
      disabled={disabled}
      layout={node.kind === 'embedded_method' ? (node.data.scale_layout ?? undefined) : undefined}
      onChange={(id, value) => onChange({ state: 'method', answers: { ...answers, [id]: value } })}
    />
  ) : (
    <OrdinaryRenderer
      node={node}
      language={language}
      variables={variables}
      tokens={flow?.text_version === 1}
      answer={answer}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
