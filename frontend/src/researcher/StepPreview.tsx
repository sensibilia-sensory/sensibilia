import { Component, useState, type ReactNode } from 'react';
import type { components } from '../api-schema';
import { NodeAnswerRenderer } from '../shared/nodes/NodeAnswerRenderer';
import type { Answer, Flow, Node } from '../shared/flow';
type Test = components['schemas']['TestRead'];
/** Example sample values so {{sample_code}} reads as a code, not as markup or a blank. */
const example = { 'sample.code': '731', 'sample.position': 1 };

class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="ui-hint">Preview unavailable until this step's settings are complete.</p>
    ) : (
      this.props.children
    );
  }
}

const previewable = new Set([
  'info',
  'consent',
  'question',
  'matrix_question',
  'confirm',
  'code_entry',
]);

// Methods that show one sample's attributes: the example sample code is all they need.
const attributeMethods = new Set(['cata-v1', 'rata-v1', 'jar-v1']);

/** What the assessor will see for the selected step, updated as it is edited. */
export function StepPreview({
  node,
  tests,
  flow,
  language,
}: {
  node: Node;
  tests: Test[];
  flow: Flow;
  language: string;
}) {
  const [answer, setAnswer] = useState<Answer>();
  const test =
    node.kind === 'embedded_method'
      ? tests.find((t) => t.id === node.data.study_test_id)
      : undefined;
  const supported =
    previewable.has(node.kind) ||
    (node.kind === 'embedded_method' &&
      (test?.test_type_id === 'hedonic-9-v1' || attributeMethods.has(test?.test_type_id ?? '')));
  if (!supported)
    return <p className="ui-hint">Open the Preview tab to see this kind of step in context.</p>;
  return (
    <Guard key={node.id + JSON.stringify(node.data) + JSON.stringify(test?.configuration)}>
      <div className="ui-step-preview" inert>
        <NodeAnswerRenderer
          node={node}
          tests={tests}
          language={language}
          flow={flow}
          variables={example}
          answer={answer}
          onChange={setAnswer}
        />
      </div>
    </Guard>
  );
}
