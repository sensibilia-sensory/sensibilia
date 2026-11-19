import type { Answer, Node, Value } from '../flow';
export const normalizeCode = (value: string, normalization: string) =>
  normalization === 'trim_upper_ascii'
    ? value.trim().replace(/[a-z]/g, (c) => c.toUpperCase())
    : value.trim();
export async function codeAnswer(
  value: string,
  normalization: string,
): Promise<Extract<Answer, { state: 'code' }>> {
  const normalized_code = normalizeCode(value, normalization);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized_code));
  return {
    state: 'code',
    normalized_code,
    code_hash: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}
export function answerValid(
  node: Node,
  answer: Answer | undefined,
  variables: Record<string, Value>,
): boolean {
  if (node.kind === 'serve_gate') {
    const codes = variables['serving.codes'] ?? [variables['sample.code']];
    return (
      answer?.state === 'delivery' &&
      JSON.stringify(answer.codes) === JSON.stringify(codes) &&
      (answer.mode === 'served' ||
        (answer.reason.trim().length > 0 &&
          answer.elapsed_ms >= (node.data.timeout_seconds ?? 120) * 1000))
    );
  }
  if (node.kind === 'info') return true;
  if (node.kind === 'confirm') return answer?.state === 'continued' && answer.acknowledged;
  if (node.kind === 'consent')
    return answer?.state === 'answered' && typeof answer.value === 'boolean';
  if (node.kind === 'code_entry')
    return (
      answer?.state === 'code' &&
      (node.data.allow_unknown ||
        (node.data.source === 'sample_code'
          ? typeof variables['sample.code'] === 'string' &&
            !!answer.normalized_code &&
            answer.normalized_code ===
              normalizeCode(variables['sample.code'] as string, node.data.normalization)
          : !!answer.normalized_code &&
            ((variables['context.returning_code_hashes'] as string[]) ?? []).includes(
              answer.code_hash,
            )))
    );
  if (node.kind === 'question') {
    const data = node.data;
    if (answer === undefined) return !data.required;
    if (answer.state === 'skipped') return data.allow_skip;
    if (answer.state !== 'answered') return false;
    const value = answer.value;
    if (data.answer_type === 'integer')
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (data.min == null || value >= data.min) &&
        (data.max == null || value <= data.max)
      );
    if (data.answer_type === 'text')
      return (
        typeof value === 'string' &&
        (!data.required || !!value.trim()) &&
        value.length <= (data.max_length ?? 30000)
      );
    if (data.answer_type === 'single')
      return typeof value === 'string' && !!data.options?.some((o) => o.id === value);
    return (
      Array.isArray(value) &&
      new Set(value).size === value.length &&
      (!data.required || value.length > 0) &&
      value.every((id) => data.options?.some((o) => o.id === id)) &&
      !(value.length > 1 && data.options?.some((o) => o.exclusive && value.includes(o.id)))
    );
  }
  if (node.kind === 'matrix_question') {
    if (!answer) return node.data.rows.every((r) => !r.required);
    if (answer.state !== 'matrix') return false;
    return (
      Object.keys(answer.answers).every((id) => node.data.rows.some((r) => r.id === id)) &&
      node.data.rows.every((row) => {
        const value = answer.answers[row.id];
        return value === undefined
          ? !row.required
          : value.state === 'skipped'
            ? node.data.allow_skip
            : node.data.options.some((o) => o.id === value.option_id);
      })
    );
  }
  return false;
}
