import { insertNear, outline, siblingEdit, type Flow, type Node } from '../flow';
import { questionnaireBlock } from './authoring';

/** A questionnaire saved to a file. Only steps that need nothing from the study. */
export const QUESTIONNAIRE_FORMAT = 'sensibilia-questionnaire';
export interface QuestionnaireFile {
  format: typeof QUESTIONNAIRE_FORMAT;
  version: 1;
  saved_at: string;
  languages: string[];
  default_language: string;
  text_version: 1 | null;
  nodes: Node[];
}
const ORDINARY = ['group', 'info', 'consent', 'confirm', 'question', 'matrix_question'];

/**
 * The same copy rules as reusing a block from a reviewed template, run over the whole set wrapped in
 * one group: conditions between the saved steps are allowed and anything that points outside them is
 * refused with a plain message. The copies get fresh step ids.
 */
function copyAll(nodes: Node[], source: Flow, target: Flow): Node[] {
  const group = {
    id: crypto.randomUUID(),
    kind: 'group',
    title: Object.fromEntries(source.languages.map((l) => [l, 'Questionnaire'])),
    otherwise: { action: 'continue' },
    data: { children: nodes },
  } as unknown as Node;
  const copy = questionnaireBlock({ ...source, nodes: [group] }, group.id, target);
  return copy.kind === 'group' ? copy.data.children : [];
}

/** The steps of the study that are plain questions and information; methods and loops stay behind. */
export function savableSteps(flow: Flow): Node[] {
  return flow.nodes.filter((n) => outline([n]).every(({ node }) => ORDINARY.includes(node.kind)));
}

export function questionnaireToFile(flow: Flow, now = new Date()): QuestionnaireFile {
  const nodes = savableSteps(flow);
  if (!nodes.length) throw new Error('There are no questions or information steps to save.');
  copyAll(nodes, flow, flow); // refuses steps that depend on something outside the saved set
  return {
    format: QUESTIONNAIRE_FORMAT,
    version: 1,
    saved_at: now.toISOString(),
    languages: flow.languages,
    default_language: flow.default_language,
    text_version: flow.text_version ?? null,
    nodes,
  };
}

/** Read a saved file for use in `target`: fresh step ids, texts in the target's languages. */
export function questionnaireFromFile(text: string, target: Flow): Node[] {
  let file: Partial<QuestionnaireFile>;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('This is not a Sensibilia questionnaire file.');
  }
  if (
    file?.format !== QUESTIONNAIRE_FORMAT ||
    file.version !== 1 ||
    !Array.isArray(file.nodes) ||
    !Array.isArray(file.languages) ||
    typeof file.default_language !== 'string'
  )
    throw new Error('This is not a Sensibilia questionnaire file, or it is from a newer version.');
  if (!file.nodes.length || file.nodes.length > 100)
    throw new Error('The file must hold between 1 and 100 steps.');
  return copyFromSource(
    file.nodes,
    {
      languages: file.languages,
      default_language: file.default_language,
      text_version: file.text_version ?? null,
    },
    target,
  );
}

/** Fresh copies of saved steps (a file or a bank item) for `target`, under the same rules. */
export function copyFromSource(
  nodes: Node[],
  source: { languages: string[]; default_language: string; text_version: 1 | null },
  target: Flow,
): Node[] {
  return copyAll(
    nodes,
    {
      schema_version: 2,
      text_version: source.text_version ?? undefined,
      languages: source.languages,
      default_language: source.default_language,
      nodes,
      method_text: {},
      restriction_tag_map: {},
    } as Flow,
    target,
  );
}

/** Put steps in order after `anchorId` (inside it when it is a group), else before the End steps. */
export function insertNodes(nodes: Node[], added: Node[], anchorId?: string): Node[] {
  let result = nodes;
  added.forEach((node, i) => {
    result =
      i === 0
        ? insertNear(result, node, anchorId)
        : siblingEdit(result, added[i - 1].id, (siblings, at) => {
            siblings.splice(at + 1, 0, node);
            return siblings;
          });
  });
  return result;
}
