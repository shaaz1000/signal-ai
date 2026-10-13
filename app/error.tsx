'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/primitives';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorState title="The discovery data could not be loaded" action={<button type="button" className="btn btn-primary" onClick={reset}>Try again</button>}>
      The database did not respond. Nothing is wrong with your connection or your filters. Try again in a moment; if it keeps happening, check that the database is reachable.
      {error.digest ? <span className="t-meta mt-2 block">Reference: {error.digest}</span> : null}
    </ErrorState>
  );
}
