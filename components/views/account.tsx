'use client';

import { useState, type FormEvent } from 'react';
import { Notice, PageHeader } from '@/components/ui/primitives';
import { HAS_BACKEND, signIn, signOut, useAccount } from '@/lib/client/platform';

export function AccountView() {
  const account = useAccount();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return setError('Paste your access token.');
    setBusy(true);
    const result = await signIn(token.trim());
    setBusy(false);
    if (result.ok) setToken('');
    else setError(result.code === '429' || result.code === 'rate_limited' ? 'Too many attempts. Wait a minute and try again.' : 'That token was not accepted. Check it and try again.');
  };

  return (
    <>
      <PageHeader title="Account" lede="Reading, searching, explanations and drafts built from stored evidence need no account. Signing in is only for requests that cost money to run: new translations and AI-written drafts." />
      {!HAS_BACKEND ? (
        <Notice>This page has no server behind it, so there is nothing to sign in to. Everything shown here was prepared in advance.</Notice>
      ) : account?.signedIn ? (
        <div className="card flex max-w-xl flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 t-small">
            <div><dt className="t-meta">Signed in as</dt><dd className="font-medium break-anywhere">{account.name || 'Unnamed account'}</dd></div>
            <div><dt className="t-meta">Plan</dt><dd className="font-medium">{account.plan}</dd></div>
            <div><dt className="t-meta">Translation</dt><dd>{account.translationAvailable ? 'Available' : 'No provider configured'}</dd></div>
            <div><dt className="t-meta">AI drafts</dt><dd>{account.generationAvailable ? 'Available' : 'No provider configured'}</dd></div>
          </dl>
          <div><button type="button" className="btn" onClick={() => void signOut()}>Sign out</button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="card flex max-w-xl flex-col gap-4">
          <div>
            <label htmlFor="access-token" className="t-small mb-1.5 block font-medium">Access token</label>
            <input id="access-token" type="password" autoComplete="off" className="field" value={token} onChange={(e) => { setToken(e.target.value); setError(''); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'token-error' : 'token-hint'} />
            <p id="token-hint" className="t-meta mt-1.5">Tokens are issued by whoever runs this site. There is no self-service sign-up.</p>
            {error ? <p id="token-error" className="t-meta mt-1.5 !text-bad" role="alert">{error}</p> : null}
          </div>
          <div><button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? 'Signing in' : 'Sign in'}</button></div>
          {account && !account.translationAvailable && !account.generationAvailable ? <Notice>No translation or AI provider is configured on this server, so signing in would not unlock anything yet.</Notice> : null}
        </form>
      )}
    </>
  );
}
