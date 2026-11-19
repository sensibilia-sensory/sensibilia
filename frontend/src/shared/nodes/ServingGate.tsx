import { useState } from 'react';
import type { Answer, Node, Value } from '../flow';
import { Button, Field, PropertyGrid } from '../../ui';
export type Delivery = Extract<Answer, { state: 'delivery' }>;
export function ServingGate({
  node,
  language,
  variables,
  onChange,
  disabled = false,
  status = 'rehearsal',
  actor = '',
  elapsed = 0,
  offline = false,
  clockQuality = 'monotonic',
  announce = true,
  onCallStaff,
  onConfirm,
}: {
  node: Extract<Node, { kind: 'serve_gate' }>;
  language: string;
  variables: Record<string, Value>;
  onChange: (a: Answer | undefined) => void;
  disabled?: boolean;
  status?: string;
  actor?: string;
  elapsed?: number;
  offline?: boolean;
  clockQuality?: 'monotonic' | 'wall_estimate';
  announce?: boolean;
  onCallStaff?: () => void;
  /** Where a confirmed delivery goes when Yes should also continue; defaults to onChange. */
  onConfirm?: (a: Answer) => void;
}) {
  const [reason, setReason] = useState(''),
    [manual, setManual] = useState(false),
    [called, setCalled] = useState(false),
    [seenStatus, setSeenStatus] = useState(status);
  // "Staff called" only bridges the gap until the server reports a new state. Once the status
  // moves on (help, acknowledged, served), the server state decides.
  if (seenStatus !== status) {
    setSeenStatus(status);
    setCalled(false);
  }
  const expected = (variables['serving.codes'] ?? [variables['sample.code']]) as string[];
  const helping = called || status === 'help';
  // Opt-in per item: staff must mark the samples delivered before the assessor can confirm.
  // After the timeout the assessor may ask staff to verify the delivery by hand.
  const required = !!node.data.require_staff_delivery;
  const timedOut = elapsed >= (node.data.timeout_seconds ?? 120) * 1000;
  const viaStaff = status === 'served' || status === 'rehearsal';
  const permitted =
    !required || (!helping && (viaStaff || (manual && timedOut && !!reason.trim())));
  return (
    <div className="ui-stack">
      <p>{node.data.body[language]}</p>
      <p role={announce ? 'status' : undefined}>
        {helping
          ? 'Staff have been called to your booth'
          : status === 'rehearsal'
            ? 'Rehearsal: simulate staff delivery'
            : status === 'served'
              ? 'Your samples have been served'
              : status === 'acknowledged'
                ? 'Your sample is being prepared'
                : 'Waiting for sample'}
        {actor ? ' · ' + actor : ''}
      </p>
      <p>
        Wait: {Math.floor(elapsed / 1000)} s{offline ? ' · Staff connection unavailable' : ''}
      </p>
      {required && !viaStaff && timedOut && !helping && (
        <Button disabled={disabled} onClick={() => setManual(true)}>
          Ask staff
        </Button>
      )}
      {required && manual && !helping && !viaStaff && (
        <>
          <p>
            Staff must physically verify this booth and delivery. Confirm only the sample actually
            received.
          </p>
          <PropertyGrid
            sections={[
              {
                title: 'Properties',
                defaultOpen: true,
                children: (
                  <Field
                    label="Manual delivery reason"
                    value={reason}
                    disabled={disabled}
                    onChange={(e) => {
                      setReason(e.target.value);
                      onChange(undefined);
                    }}
                  />
                ),
              },
            ]}
          />
        </>
      )}
      <p>
        <strong>Do you now have {expected.length === 1 ? 'sample' : 'samples'}</strong>{' '}
        <strong className="ui-sample-code">{expected.join(', ')}</strong>{' '}
        <strong>in front of you?</strong>
      </p>
      {/* By default the assessor's confirmation is the delivery; staff need not mark it served. */}
      <Button
        variant="primary"
        disabled={disabled || !permitted}
        onClick={() =>
          (onConfirm ?? onChange)({
            state: 'delivery',
            mode: required && manual && !viaStaff ? 'manual' : 'served',
            codes: expected,
            reason: required && manual && !viaStaff ? reason : '',
            elapsed_ms: Math.floor(elapsed),
            clock_quality: clockQuality,
            offline,
          })
        }
      >
        Yes, I have them
      </Button>
      <Button
        disabled={disabled || helping}
        onClick={() => {
          setCalled(true);
          onChange(undefined);
          onCallStaff?.();
        }}
      >
        No, call staff
      </Button>
    </div>
  );
}
