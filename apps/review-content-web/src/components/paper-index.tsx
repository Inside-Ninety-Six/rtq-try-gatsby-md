import {
  getContentWorkspaceStatus,
  listPaperSources,
  type PaperSourceSummary,
} from '@rtq/review-paper-model';

import {
  FileBrowser,
  type BrowserCollection,
  type BrowserPaper,
} from '@/components/file-browser';
import { SiteHeader } from '@/components/site-header';
import { getWorkspaceStatusCopy } from '@/lib/workspace-view-model';

function browserPaper(summary: PaperSourceSummary): BrowserPaper {
  if (summary.state === 'invalid') {
    return {
      collectionId: summary.collection.id,
      detail: summary.message,
      fileName: summary.fileName,
      focusGroups: [],
      provenance: 'invalid',
      relativePath: summary.relativePath,
      state: 'invalid',
      title: summary.title,
    };
  }

  const source = summary.source;
  const detail = [
    source.topic ? `Topic · ${source.topic}` : undefined,
    source.ragGrouping ? `RAG · ${source.ragGrouping}` : undefined,
    source.focusGroups.length
      ? `Focus · ${source.focusGroups.join(', ')}`
      : undefined,
    !source.topic && !source.ragGrouping && source.focusGroups.length === 0
      ? source.collection.description
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    collectionId: source.collection.id,
    detail,
    fileName: source.fileName,
    focusGroups: source.focusGroups,
    provenance: source.provenance.kind,
    questionCount: source.questionCount,
    relativePath: source.relativePath,
    state: 'ready',
    title: source.title,
  };
}

export async function PaperIndex({
  initialCollectionId,
  initialQuery,
}: {
  initialCollectionId?: string;
  initialQuery?: string;
}) {
  const workspaceStatus = getContentWorkspaceStatus();
  const statusCopy = getWorkspaceStatusCopy(workspaceStatus);
  let sources: readonly PaperSourceSummary[] = [];
  let loadIssue: string | undefined;

  if (workspaceStatus.state === 'ready') {
    try {
      sources = await listPaperSources();
    } catch (error) {
      loadIssue =
        error instanceof Error
          ? error.message
          : 'The paper index could not load.';
    }
  }

  const papers = sources.map(browserPaper);
  const collectionMap = new Map<string, BrowserCollection>();
  for (const summary of sources) {
    const collection =
      summary.state === 'ready'
        ? summary.source.collection
        : summary.collection;
    const current = collectionMap.get(collection.id);
    collectionMap.set(collection.id, {
      count: (current?.count ?? 0) + 1,
      description: collection.description,
      id: collection.id,
      label: collection.label,
    });
  }
  const collections = [...collectionMap.values()];
  const activeCollectionId = initialCollectionId ?? collections[0]?.id;

  return (
    <main className="review-shell" id="top">
      <SiteHeader />
      <section className="index-intro">
        <div>
          <p className="eyebrow">Review content</p>
          <h1>Choose a paper</h1>
          <p className="hero-summary">
            Browse the live RTQ content checkout and open a paper for review.
          </p>
        </div>
        <aside
          className={`connection-card connection-card--${statusCopy.tone}`}
        >
          <span className="connection-light" aria-hidden="true" />
          <div>
            <p>{statusCopy.label}</p>
            <span>{loadIssue ?? statusCopy.detail}</span>
          </div>
        </aside>
      </section>

      {papers.length > 0 && activeCollectionId ? (
        <FileBrowser
          activeCollectionId={activeCollectionId}
          collections={collections}
          initialQuery={initialQuery}
          key={`${activeCollectionId}:${initialQuery ?? ''}`}
          papers={papers}
        />
      ) : (
        <section className="workspace-empty" aria-live="polite">
          <p className="eyebrow">Paper index unavailable</p>
          <h2>Connect a complete rtq-content checkout.</h2>
          <p>{loadIssue ?? statusCopy.detail}</p>
        </section>
      )}
    </main>
  );
}
