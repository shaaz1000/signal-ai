import Link from 'next/link';
import { EmptyState } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <EmptyState title="That page does not exist" action={<Link href="/discover" className="btn btn-primary">Browse discoveries</Link>}>
      The discovery may have been archived, or the link may be incomplete.
    </EmptyState>
  );
}
