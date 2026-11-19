import { useState } from 'react';
import { AssessorShell, Button, Field } from '../ui';
import { navigate } from '../router';
import { redeemPairing } from './terminal';

/** Tablet side of pairing: the QR code opens this page with the code in the URL fragment. */
export function PairTablet() {
  const [code, setCode] = useState(() => decodeURIComponent(window.location.hash.slice(1)));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [paired, setPaired] = useState<{ name: string; durable: boolean }>();
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await redeemPairing(code);
      window.history.replaceState(null, '', window.location.pathname);
      setPaired(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AssessorShell
      label="Register this tablet"
      actions={
        paired ? (
          <Button
            variant="primary"
            className="ui-assessor-action"
            onClick={() => navigate('/assessor/')}
          >
            Continue
          </Button>
        ) : (
          <Button
            variant="primary"
            className="ui-assessor-action"
            disabled={busy || code.trim().length < 6}
            onClick={() => void submit()}
          >
            Register this tablet
          </Button>
        )
      }
    >
      <h1>{paired ? paired.name + ' registered' : 'Register this tablet'}</h1>
      {paired ? (
        <p role="status">
          This tablet is registered. Staff assign its assessment from the researcher screen.
          {paired.durable
            ? ''
            : ' Persistent storage was not granted; device acceptance is required before collection.'}
        </p>
      ) : (
        <>
          <Field
            label="Pairing code"
            value={code}
            mono
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={busy}
          />
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </AssessorShell>
  );
}
