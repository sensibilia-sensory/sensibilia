import type { Flow, Test, Value } from './index';
import { outline } from './index';
import { configurationErrors, type Configuration } from '../methods/registry';
export function methodTextFields(config: Configuration): Record<string, string> {
  return Object.fromEntries([
    ['/instructions', config.instructions],
    ...('attributes' in config
      ? config.attributes.map((a, i) => ['/attributes/' + i + '/prompt', a.prompt])
      : []),
    ...('start_instruction' in config ? [['/start_instruction', config.start_instruction]] : []),
    ...('descriptor_instructions' in config
      ? [
          ['/descriptor_instructions', config.descriptor_instructions],
          ['/ranking_instructions', config.ranking_instructions],
        ]
      : []),
    ...('questions' in config ? config.questions : []).map((q, i) => [
      '/questions/' + i + '/prompt',
      q.prompt,
    ]),
    ...('scale_labels' in config ? (config.scale_labels ?? []) : []).map((label, i) => [
      '/scale_labels/' + i,
      label,
    ]),
  ]);
}
export function localizedConfiguration<T extends Configuration>(
  config: T,
  overlays: Record<string, Record<string, string>> = {},
  language: string,
  variables: Record<string, Value> = {},
  tokens = true,
): T {
  const result = structuredClone(config);
  for (const pointer of Object.keys(methodTextFields(config))) {
    const parts = pointer.slice(1).split('/');
    // Pointers are limited to method-owned textual fields, never IDs or scale values.
    const original = methodTextFields(config)[pointer];
    const text = displayText(overlays[pointer]?.[language] ?? original, variables, tokens);
    if (parts[0] === 'questions' && 'questions' in result)
      result.questions[Number(parts[1])].prompt = text;
    else if (parts[0] === 'scale_labels' && 'scale_labels' in result)
      result.scale_labels![Number(parts[1])] = text;
    else if (parts[0] === 'attributes' && 'attributes' in result)
      result.attributes[Number(parts[1])].prompt = text;
    else if (parts[0] === 'start_instruction' && 'start_instruction' in result)
      result.start_instruction = text;
    else if (parts[0] === 'instructions') result.instructions = text;
    else if (parts[0] === 'descriptor_instructions' && 'descriptor_instructions' in result)
      result.descriptor_instructions = text;
    else if (parts[0] === 'ranking_instructions' && 'ranking_instructions' in result)
      result.ranking_instructions = text;
  }
  return result;
}
export function displayText(value: string, variables: Record<string, Value> = {}, tokens = true) {
  if (!tokens) return value;
  // $SAMPLE is shorthand for {{sample_code}}.
  return value.replace(
    /{{\s*(sample_code|sample_position)\s*}}|\$SAMPLE\b/g,
    (_, key: string | undefined) =>
      String(variables[key === 'sample_position' ? 'sample.position' : 'sample.code'] ?? ''),
  );
}
export function textIssues(flow: Flow, tests: Test[]): string[] {
  const issues: string[] = [];
  const entries = outline(flow.nodes);
  const loops = new Set(
    entries.filter((e) => e.node.kind === 'loop_samples').map((e) => e.node.id),
  );
  const fields = new Set([
    'title',
    'body',
    'prompt',
    'label',
    'instructions',
    'continue_label',
    'accept_label',
    'decline_label',
    'ack_label',
    'preparation',
  ]);
  const check = (
    texts: Record<string, string>,
    field: string,
    inLoop: boolean,
    blankOk = false,
  ) => {
    for (const language of flow.languages) {
      const text = texts[language] ?? '';
      if (!text.trim() && !blankOk) issues.push(field + ': review nonblank ' + language + ' text.');
      if (flow.text_version !== 1) continue;
      const rest = text.replace(/{{\s*([^{}]+?)\s*}}/g, (_, token: string) => {
        if (!['sample_code', 'sample_position'].includes(token))
          issues.push(field + ': unknown token ' + token);
        else if (!inLoop) issues.push(field + ': token requires sample scope.');
        return '';
      });
      if (!inLoop && /\$SAMPLE\b/.test(text))
        issues.push(field + ': $SAMPLE requires sample scope.');
      if (rest.includes('{{') || rest.includes('}}')) issues.push(field + ': malformed token.');
    }
    if (Object.keys(texts).some((l) => !flow.languages.includes(l)))
      issues.push(field + ': undeclared language.');
  };
  const visit = (value: unknown, field: string, inLoop: boolean) => {
    if (Array.isArray(value)) value.forEach((v, i) => visit(v, field + '.' + i, inLoop));
    else if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        if (fields.has(key)) check(child as Record<string, string>, field + '.' + key, inLoop);
        else if (key !== 'children') visit(child, field + '.' + key, inLoop);
      }
  };
  for (const entry of entries)
    visit(
      entry.node,
      entry.number,
      entry.ancestors.some((a) => loops.has(a)),
    );
  for (const test of tests) {
    const config = test.configuration as Configuration;
    const pointers = methodTextFields(config);
    const overlays = flow.method_text?.[test.id] ?? {};
    const entry = entries.find(
      (e) => e.node.kind === 'embedded_method' && e.node.data.study_test_id === test.id,
    );
    const inLoop = !!entry?.ancestors.some((a) => loops.has(a));
    for (const key of Object.keys(overlays))
      if (!(key in pointers)) issues.push('Invalid method text pointer: ' + key);
    for (const [pointer, value] of Object.entries(pointers)) {
      const texts = overlays[pointer] ?? { [flow.default_language]: value };
      // A scale step left unnamed on purpose has nothing to translate.
      check(texts, pointer, inLoop, pointer.startsWith('/scale_labels/') && !value.trim());
      if (texts[flow.default_language] !== value)
        issues.push(pointer + ': default overlay must match method configuration.');
    }
    for (const language of flow.languages)
      if (
        Object.keys(
          configurationErrors(localizedConfiguration(config, overlays, language, {}, false)),
        ).length
      )
        issues.push('Invalid method translation: ' + language);
  }
  return [...new Set(issues)];
}

/** Keep prompt translations with stable question IDs when the default editor reorders rows. */
export function reconcileMethodText(
  previous: Configuration,
  next: Configuration,
  overlays: Record<string, Record<string, string>>,
  defaultLanguage: string,
) {
  return Object.fromEntries(
    Object.entries(methodTextFields(next)).map(([pointer, text]) => {
      let original = pointer;
      if (pointer.startsWith('/questions/') && 'questions' in previous && 'questions' in next) {
        const index = Number(pointer.split('/')[2]);
        const prior = previous.questions.findIndex((q) => q.id === next.questions[index].id);
        original = prior < 0 ? '' : '/questions/' + prior + '/prompt';
      }
      if (pointer.startsWith('/attributes/') && 'attributes' in previous && 'attributes' in next) {
        const index = Number(pointer.split('/')[2]);
        const prior = previous.attributes.findIndex((a) => a.id === next.attributes[index].id);
        original = prior < 0 ? '' : '/attributes/' + prior + '/prompt';
      }
      return [pointer, { ...(overlays[original] ?? {}), [defaultLanguage]: text }];
    }),
  );
}

/** Remove only localized text entries; option IDs and restriction mappings are independent. */
export function removeLanguage(flow: Flow, language: string): Flow {
  const fields = new Set([
    'title',
    'body',
    'prompt',
    'label',
    'instructions',
    'continue_label',
    'accept_label',
    'decline_label',
    'ack_label',
    'preparation',
  ]);
  const drop = (text: Record<string, string>) =>
    Object.fromEntries(Object.entries(text).filter(([lang]) => lang !== language));
  const visit = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(visit)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
              key,
              fields.has(key) ? drop(child as Record<string, string>) : visit(child),
            ]),
          )
        : value;
  return {
    ...flow,
    languages: flow.languages.filter((lang) => lang !== language),
    nodes: visit(flow.nodes) as Flow['nodes'],
    method_text: Object.fromEntries(
      Object.entries(flow.method_text ?? {}).map(([id, overlays]) => [
        id,
        Object.fromEntries(
          Object.entries(overlays).map(([pointer, text]) => [pointer, drop(text)]),
        ),
      ]),
    ),
  };
}
