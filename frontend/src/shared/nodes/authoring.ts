import schema from '../../../../docs/contracts/draft_flow_v2.json' with { type: 'json' };
import { outline, type Node, type Flow } from '../flow';
import { kindLabel } from '../lexicon';
export const nodeKinds = [
  'info',
  'consent',
  'question',
  'matrix_question',
  'group',
  'loop_samples',
  'confirm',
  'code_entry',
  'serve_gate',
  'end',
] as const;
export function newNode(kind: (typeof nodeKinds)[number], language: string): Node {
  const text = (value = '') => ({ [language]: value });
  const base = { id: crypto.randomUUID(), title: text(kindLabel(kind)) };
  switch (kind) {
    case 'info':
      return { ...base, kind, data: { body: text(), continue_label: text('Continue') } };
    case 'consent':
      return { ...base, kind, data: { body: text(), accept_label: text(), decline_label: text() } };
    case 'question':
      return {
        ...base,
        kind,
        data: {
          prompt: text(),
          answer_type: 'single',
          options: [
            { id: 'option_1', exclusive: false, label: text() },
            { id: 'option_2', exclusive: false, label: text() },
          ],
          required: true,
          allow_skip: false,
          layout: 'vertical',
        },
      };
    case 'matrix_question':
      return {
        ...base,
        kind,
        data: {
          instructions: text(),
          rows: [{ id: 'row_1', prompt: text(), required: true }],
          options: [
            { id: 'option_1', exclusive: false, label: text() },
            { id: 'option_2', exclusive: false, label: text() },
          ],
          allow_skip: false,
          layout: 'vertical',
        },
      };
    case 'loop_samples':
      return { ...base, kind, data: { sample_ids: [], children: [] } };
    case 'group':
      return { ...base, kind, data: { children: [] } };
    case 'confirm':
      return { ...base, kind, data: { body: text(), ack_label: text() } };
    case 'code_entry':
      return {
        ...base,
        kind,
        data: {
          prompt: text(),
          source: 'returning_codes',
          allow_unknown: true,
          normalization: 'trim_exact',
        },
      };
    case 'serve_gate':
      return {
        ...base,
        title: text('Wait for sample'),
        kind,
        data: {
          body: text('Wait for staff delivery and confirm the code before tasting.'),
          preparation: text('One portion'),
          sample_binding: 'set',
          sample_ids: [],
          require_staff_delivery: false,
          timeout_seconds: 120,
        },
      };
    case 'end':
      return { ...base, kind, data: { body: text(), outcome: 'completed' } };
  }
}
type Schema = {
  type?: string;
  $ref?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  patternProperties?: Record<string, Schema>;
  anyOf?: Schema[];
  [key: string]: unknown;
};
const definitions = schema.$defs as Record<string, Schema>;
const names: Record<Node['kind'], string> = {
  info: 'InfoData',
  consent: 'ConsentData',
  question: 'QuestionData',
  matrix_question: 'MatrixData',
  group: 'GroupData',
  loop_samples: 'LoopData',
  confirm: 'ConfirmData',
  code_entry: 'CodeData',
  serve_gate: 'ServeData',
  end: 'EndData',
  embedded_method: 'MethodData',
};
const resolve = (s: Schema): Schema => (s.$ref ? definitions[s.$ref.split('/').at(-1)!] : s);
/** Adapt generated localized schema to the current authoring language, preserving other text. */
export function nodeFields(node: Node, language: string, compactBattery = false) {
  const adapt = (raw: Schema): Schema => {
    const s = resolve(raw);
    if (s.patternProperties) return { type: 'string', maxLength: 30000 };
    if (s.anyOf) return { ...s, anyOf: s.anyOf.map(adapt) };
    if (s.type === 'object')
      return {
        ...s,
        properties: Object.fromEntries(
          Object.entries(s.properties ?? {})
            .filter(
              ([k]) =>
                !['children', 'asset_ids', 'sample_ids', 'study_test_id', 'layout'].includes(k) &&
                !(
                  k === 'timeout_seconds' &&
                  node.kind === 'serve_gate' &&
                  !node.data.require_staff_delivery
                ) &&
                !(compactBattery && ['rows', 'options'].includes(k)) &&
                !(k === 'body' && node.kind === 'info') &&
                !(k === 'score' && node.kind === 'question') &&
                !(
                  k === 'exclusive' &&
                  (node.kind === 'matrix_question' ||
                    (node.kind === 'question' && node.data.answer_type !== 'multiple'))
                ) &&
                !(
                  node.kind === 'question' &&
                  ((k === 'options' && !['single', 'multiple'].includes(node.data.answer_type)) ||
                    (['min', 'max'].includes(k) && node.data.answer_type !== 'integer') ||
                    (k === 'max_length' && node.data.answer_type !== 'text'))
                ),
            )
            .map(([k, v]) => [k, adapt(v)]),
        ),
      };
    if (s.type === 'array') return { ...s, items: adapt(s.items!) };
    return s;
  };
  const transform = (raw: Schema, value: unknown, toText: boolean, original?: unknown): unknown => {
    const s = resolve(raw);
    if (s.patternProperties)
      return toText
        ? ((value as Record<string, string>)?.[language] ?? '')
        : { ...((original as object) ?? {}), [language]: value };
    if (s.anyOf && value == null) return value;
    if (s.anyOf)
      return transform(
        s.anyOf.find((s) => s.type !== 'null')!,
        value,
        toText,
        original,
      );
    if (s.type === 'object')
      return Object.fromEntries(
        Object.entries((value as Record<string, unknown>) ?? {}).map(([k, v]) => [
          k,
          s.properties?.[k]
            ? transform(s.properties[k], v, toText, (original as Record<string, unknown>)?.[k])
            : v,
        ]),
      );
    if (s.type === 'array')
      return ((value as unknown[]) ?? []).map((v, i) => {
        const items = (original as unknown[]) ?? [];
        const id = v && typeof v === 'object' ? (v as { id?: unknown }).id : undefined;
        const prior = id
          ? items.find(
              (item) => item && typeof item === 'object' && (item as { id?: unknown }).id === id,
            )
          : items[i];
        return transform(s.items!, v, toText, prior);
      });
    return value;
  };
  const raw = definitions[names[node.kind]];
  return {
    schema: adapt(raw),
    value: transform(raw, node.data, true),
    restore: (value: unknown) => transform(raw, value, false, node.data),
  };
}
export function changeAnswerType(node: Node, next: Node): Node {
  if (
    node.kind !== 'question' ||
    next.kind !== 'question' ||
    node.data.answer_type === next.data.answer_type
  )
    return next;
  const { options: _o, min: _min, max: _max, max_length: _length, ...data } = next.data;
  // Only single choice can be laid out as a row of points.
  if (next.data.answer_type !== 'single') data.layout = 'vertical';
  if (next.data.answer_type === 'single' || next.data.answer_type === 'multiple')
    return {
      ...next,
      data: {
        ...data,
        options: (
          node.data.options ?? [
            {
              id: 'option_1',
              exclusive: false,
              label: { ...node.title, [Object.keys(node.title)[0]]: '' },
            },
            {
              id: 'option_2',
              exclusive: false,
              label: { ...node.title, [Object.keys(node.title)[0]]: '' },
            },
          ]
        ).map((option) =>
          next.data.answer_type === 'single' ? { ...option, exclusive: false } : option,
        ),
      },
    };
  return { ...next, data };
}

/** Structural moves keep each method bound to its actual sample scope. */
export function bindMethods(nodes: Node[], inLoop = false): Node[] {
  return nodes.map((node) =>
    node.kind === 'serve_gate'
      ? {
          ...node,
          data: {
            ...node.data,
            sample_binding: inLoop ? 'current' : 'set',
            sample_ids: inLoop ? [] : node.data.sample_ids,
          },
        }
      : node.kind === 'embedded_method'
        ? {
            ...node,
            data: {
              ...node.data,
              sample_binding:
                node.data.sample_binding === 'set' ? 'set' : inLoop ? 'current' : 'none',
            },
          }
        : node.kind === 'group' || node.kind === 'loop_samples'
          ? ({
              ...node,
              data: {
                ...node.data,
                children: bindMethods(node.data.children, inLoop || node.kind === 'loop_samples'),
              },
            } as Node)
          : node,
  );
}

/** Fresh structural IDs; row/option IDs and references within the subtree stay coherent. */
export function cloneNode(source: Node): Node {
  const cloned = structuredClone(source);
  const entries = outline([cloned]);
  const ids = new Map(entries.map(({ node }) => [node.id, crypto.randomUUID()]));
  for (const { node } of entries) {
    node.id = ids.get(node.id)!;
    const remap = (condition: NonNullable<Node['guard']>): void => {
      if ('all' in condition) condition.all.forEach(remap);
      else if ('any' in condition) condition.any.forEach(remap);
      else {
        const parts = condition.variable.split('.');
        if (parts[0] === 'answer' && ids.has(parts[1])) {
          parts[1] = ids.get(parts[1])!;
          condition.variable = parts.join('.');
        }
      }
    };
    if (node.guard) remap(node.guard);
    if (node.otherwise && 'target_id' in node.otherwise)
      node.otherwise.target_id = ids.get(node.otherwise.target_id) ?? node.otherwise.target_id;
  }
  return cloned;
}

/** Import only self-contained questionnaires; publication still uses existing flow validation. */
export function questionnaireBlock(source: Flow, id: string, target: Flow): Node {
  const root = outline(source.nodes).find(({ node }) => node.id === id)?.node;
  if (!root) throw new Error('Block not found in the reviewed publication.');
  const entries = outline([root]),
    ids = new Set(entries.map(({ node }) => node.id));
  if (
    entries.some(
      ({ node }) =>
        !['group', 'info', 'consent', 'confirm', 'question', 'matrix_question'].includes(node.kind),
    )
  )
    throw new Error('Choose an ordinary question, battery or self-contained questionnaire group.');
  if (source.restriction_source_id && ids.has(source.restriction_source_id))
    throw new Error(
      'Restriction sources require study-level review; use the complete study template.',
    );
  if ((source.text_version ?? null) !== (target.text_version ?? null))
    throw new Error('Source and target must use the same reviewed text convention.');
  const check = (condition: NonNullable<Node['guard']>): void => {
    if ('all' in condition) condition.all.forEach(check);
    else if ('any' in condition) condition.any.forEach(check);
    else if (
      condition.variable.startsWith('answer.')
        ? !ids.has(condition.variable.split('.')[1])
        : !condition.variable.startsWith('context.')
    )
      throw new Error(
        'Block depends on answers or sample context outside this block. Use the complete study template.',
      );
  };
  for (const { node } of entries) {
    if (node.kind === 'info' && node.data.asset_ids?.length)
      throw new Error('Image references require the complete study template.');
    if (node.guard) check(node.guard);
    if (
      node.otherwise &&
      ('target_id' in node.otherwise
        ? !ids.has(node.otherwise.target_id)
        : node.otherwise.action !== 'continue')
    )
      throw new Error('Block has an external route. Use the complete study template.');
  }
  const cloned = cloneNode(root);
  const textFields = new Set([
    'title',
    'body',
    'prompt',
    'label',
    'instructions',
    'continue_label',
    'accept_label',
    'decline_label',
    'ack_label',
  ]);
  const localized = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(localized);
    else if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      for (const [key, child] of Object.entries(obj)) {
        if (textFields.has(key)) {
          const texts = child as Record<string, string>;
          if (target.languages.some((language) => !texts[language]?.trim()))
            throw new Error('Every target language needs reviewed text in the source block.');
          obj[key] = Object.fromEntries(
            target.languages.map((language) => [language, texts[language]]),
          );
        } else localized(child);
      }
    }
  };
  localized(cloned);
  return cloned;
}

export type MatrixNode = Extract<Node, { kind: 'matrix_question' }>;
export function appendBatteryRows(
  node: MatrixNode,
  text: string,
  language: string,
  required: boolean,
): MatrixNode {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (!text.trim() || lines.some((line) => !line.trim() || line.length > 30000))
    throw new Error('Enter one nonblank prompt per line (maximum 30,000 characters each).');
  if (node.data.rows.length + lines.length > 100)
    throw new Error('A battery supports at most 100 rows.');
  const used = new Set(node.data.rows.map((row) => row.id));
  return {
    ...node,
    data: {
      ...node.data,
      rows: [
        ...node.data.rows,
        ...lines.map((prompt) => {
          let id: string;
          do {
            id = 'item_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
          } while (used.has(id));
          used.add(id);
          return { id, prompt: { [language]: prompt }, required };
        }),
      ],
    },
  };
}

export function translateBatteryRows(node: MatrixNode, text: string, language: string): MatrixNode {
  const updates = new Map<string, string>();
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const parts = line.split('\t');
    if (
      parts.length !== 2 ||
      !node.data.rows.some((row) => row.id === parts[0]) ||
      updates.has(parts[0]) ||
      !parts[1].trim() ||
      parts[1].length > 30000
    )
      throw new Error(
        'Use unique existing row IDs followed by a tab and a nonblank reviewed translation.',
      );
    updates.set(parts[0], parts[1]);
  }
  return {
    ...node,
    data: {
      ...node.data,
      rows: node.data.rows.map((row) =>
        updates.has(row.id)
          ? { ...row, prompt: { ...row.prompt, [language]: updates.get(row.id)! } }
          : row,
      ),
    },
  };
}
