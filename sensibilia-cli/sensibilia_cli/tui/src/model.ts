export type Selection = { section: string; id?: string };
export type Option = { label: string; value: any };
export type Field = {
  path: string;
  label: string;
  type: string;
  value: any;
  options: Option[];
  optionsFrom?: "samples" | "selectedSamples";
  visibleWhen?: { path: string; value: unknown };
  reactive?: boolean;
};
export type MethodForm = { fields: Field[]; notes: string[] };
export interface Snapshot {
  file: string;
  hash: string;
  document: any;
  selection: Selection;
  canUndo: boolean;
  message?: string;
  view: {
    title: string;
    fields: Field[];
    arrays: { path: string; label: string; count: number }[];
    preview: string;
    details: any;
    advanced: any;
    notes?: string[];
  };
}
export const kindNames: Record<string, string> = {
  info: "Instructions",
  consent: "Consent",
  question: "Question",
  matrix_question: "Battery",
  embedded_method: "Sensory test",
  group: "Group",
  loop_samples: "Sample loop",
  confirm: "Acknowledgment",
  code_entry: "Enter code",
  serve_gate: "Wait for sample",
  end: "End",
};
export function outline(document: any) {
  const rows: {
    id: string;
    title: string;
    kind: string;
    number: string;
    parent?: string;
  }[] = [];
  function walk(nodes: any[], prefix = "", parent?: string) {
    nodes.forEach((node, index) => {
      const number = prefix + (index + 1);
      rows.push({
        id: node.id,
        title: node.title[document.form.default_language] ?? "Untitled",
        kind: node.kind,
        number,
        parent,
      });
      if (node.data.children) walk(node.data.children, number + ".", node.id);
    });
  }
  walk(document.form.nodes);
  return rows;
}
export function parseField(field: Field, value: string) {
  if (field.type === "lines")
    return value.trim() ? value.replaceAll("\r", "").split("\n") : [];
  if (field.type === "json") return JSON.parse(value);
  if (field.type === "number") {
    if (!value.trim()) return null;
    const number = Number(value);
    if (!Number.isFinite(number))
      throw new Error(`${field.label} needs a finite number.`);
    return number;
  }
  return value;
}
