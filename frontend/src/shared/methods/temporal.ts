import type { components } from '../../api-schema';
export type TemporalValue = components['schemas']['TemporalValue'];
export type TemporalConfig = components['schemas']['TCATAConfiguration'];
export type TemporalDraft = Omit<TemporalValue, 'state'> & {
  state: TemporalValue['state'] | 'running';
  client_event_id: string;
};
export function activeAttributes(transitions: TemporalValue['transitions'], at = Infinity) {
  const active = new Set<string>();
  for (const event of transitions)
    if (event.elapsed_ms <= at) {
      if (event.selected) active.add(event.attribute_id);
      else active.delete(event.attribute_id);
    }
  return active;
}
export function temporalValid(config: TemporalConfig, value: TemporalValue) {
  if (value.state === 'skipped')
    return (
      !!config.allow_skips &&
      value.started_at == null &&
      value.elapsed_ms === 0 &&
      !value.transitions.length &&
      !value.interruption_flags.length
    );
  if (
    !value.started_at ||
    Date.parse(value.ended_at) < Date.parse(value.started_at) ||
    value.elapsed_ms > config.duration_ms
  )
    return false;
  if (
    value.state === 'complete'
      ? value.elapsed_ms !== config.duration_ms || !!value.interruption_flags.length
      : !value.interruption_flags.length
  )
    return false;
  const active = new Set<string>(),
    ids = new Set<string>();
  let elapsed = 0;
  return value.transitions.every((e, i) => {
    if (
      e.seq !== i + 1 ||
      !Number.isInteger(e.elapsed_ms) ||
      e.elapsed_ms < elapsed ||
      e.elapsed_ms > value.elapsed_ms ||
      !config.attributes.some((a) => a.id === e.attribute_id) ||
      ids.has(e.client_event_id) ||
      active.has(e.attribute_id) === e.selected
    )
      return false;
    ids.add(e.client_event_id);
    elapsed = e.elapsed_ms;
    if (e.selected) active.add(e.attribute_id);
    else active.delete(e.attribute_id);
    return true;
  });
}
export function interrupted(
  draft: TemporalDraft,
  flag: TemporalValue['interruption_flags'][number],
  elapsed = draft.elapsed_ms,
): TemporalDraft {
  return {
    ...draft,
    state: 'interrupted',
    elapsed_ms: elapsed,
    ended_at: new Date().toISOString(),
    interruption_flags: [...new Set([...draft.interruption_flags, flag])],
  };
}
