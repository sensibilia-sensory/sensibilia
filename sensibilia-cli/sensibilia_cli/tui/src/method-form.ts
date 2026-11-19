import type { Field } from "./model";

/** Resolve presentation dependencies sent by Python. No method rules live here. */
export function methodFields(
  fields: Field[],
  value: (field: Field) => any,
  samples: any[],
): Field[] {
  const get = (path: string) => {
    const field = fields.find((item) => item.path === path);
    return field ? value(field) : undefined;
  };
  return fields
    .filter(
      (field) =>
        !field.visibleWhen ||
        get(field.visibleWhen.path) === field.visibleWhen.value,
    )
    .map((field) => {
      if (!field.optionsFrom) return field;
      const selected = get("/configuration/sample_ids") ?? [];
      const options = samples
        .filter(
          (sample) =>
            field.optionsFrom === "samples" || selected.includes(sample.id),
        )
        .map((sample) => ({
          value: sample.id,
          label: `${sample.code} — ${sample.label}`,
        }));
      return {
        ...field,
        options:
          field.type === "choice"
            ? [{ value: null, label: "Choose sample" }, ...options]
            : options,
      };
    });
}
