import Link from 'next/link';

import type { ReviewOutcomeDestination } from '@/lib/review-types';

export function SiteHeader({
  compact = false,
  outcomeDestination,
}: {
  compact?: boolean;
  outcomeDestination?: ReviewOutcomeDestination;
}) {
  const outcomeDestinationLabel =
    outcomeDestination === 'database'
      ? 'Outcomes & comments → local SQLite'
      : outcomeDestination === 'google-sheets'
        ? 'Outcomes → Sheets · comments → local SQLite'
        : undefined;

  return (
    <header className={`masthead${compact ? ' masthead--compact' : ''}`}>
      <Link className="wordmark" href="/" aria-label="RTQ Review Content home">
        <span aria-hidden="true">RTQ</span>
        <span>Review content</span>
      </Link>
      <div className="masthead-status">
        <span className="read-only-dot" aria-hidden="true" />
        <span>Direct source · read only</span>
        {outcomeDestinationLabel ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{outcomeDestinationLabel}</span>
          </>
        ) : null}
      </div>
    </header>
  );
}
