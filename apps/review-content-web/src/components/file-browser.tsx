'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { collectionRoute, paperRoute } from '@/lib/review-view-model';

export type BrowserCollection = Readonly<{
  count: number;
  description: string;
  id: string;
  label: string;
}>;

export type BrowserPaper = Readonly<{
  collectionId: string;
  detail: string;
  fileName: string;
  focusGroups: readonly string[];
  provenance: string;
  questionCount?: number;
  relativePath: string;
  state: 'invalid' | 'ready';
  title: string;
}>;

const PAGE_SIZE = 80;

export function FileBrowser({
  activeCollectionId,
  collections,
  initialQuery = '',
  papers,
}: {
  activeCollectionId: string;
  collections: readonly BrowserCollection[];
  initialQuery?: string;
  papers: readonly BrowserPaper[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return papers.filter(
      (paper) =>
        paper.collectionId === activeCollectionId &&
        (!needle ||
          [
            paper.title,
            paper.fileName,
            paper.detail,
            ...paper.focusGroups,
          ].some((value) => value.toLocaleLowerCase().includes(needle))),
    );
  }, [activeCollectionId, papers, query]);
  const active = collections.find(
    (collection) => collection.id === activeCollectionId,
  );

  function updateQuery(value: string) {
    setQuery(value);
    setVisibleCount(PAGE_SIZE);
    const parameters = new URLSearchParams(window.location.search);
    const normalized = value.trim();
    if (normalized) parameters.set('q', normalized);
    else parameters.delete('q');
    const serialized = parameters.toString();
    window.history.replaceState(
      null,
      '',
      serialized
        ? `${window.location.pathname}?${serialized}`
        : window.location.pathname,
    );
  }

  return (
    <section className="browser" aria-labelledby="browser-title">
      <aside className="collection-rail" aria-label="Paper collections">
        <div className="rail-heading">
          <p>Collections</p>
          <span>{papers.length.toLocaleString()} files</span>
        </div>
        <div className="collection-list">
          {collections.map((collection) => (
            <Link
              aria-current={
                collection.id === activeCollectionId ? 'page' : undefined
              }
              className="collection-button"
              href={collectionRoute(collection.id)}
              key={collection.id}
            >
              <span>{collection.label}</span>
              <strong>{collection.count}</strong>
            </Link>
          ))}
        </div>
        <nav className="reference-list" aria-label="Reference content">
          <p>Reference</p>
          <Link className="reference-link" href="/macros">
            <span>Macros</span>
            <strong>1 file</strong>
          </Link>
        </nav>
      </aside>

      <div className="file-index">
        <div className="file-index-heading">
          <div>
            <p className="eyebrow">Live TOML index</p>
            <h2 id="browser-title">{active?.label ?? 'Paper files'}</h2>
            <span>{active?.description}</span>
          </div>
          <label className="search-field">
            <span>Find within collection</span>
            <input
              onChange={(event) => {
                updateQuery(event.target.value);
              }}
              placeholder="Title, filename, focus group…"
              type="search"
              value={query}
            />
          </label>
        </div>

        <div className="result-summary" aria-live="polite">
          <span>{matches.length.toLocaleString()} matching files</span>
          <span>Updated from the working tree on refresh</span>
        </div>

        {matches.length === 0 ? (
          <div className="empty-index">
            <strong>No files match this view.</strong>
            <p>Clear the search or choose another source collection.</p>
          </div>
        ) : (
          <ol className="paper-list">
            {matches.slice(0, visibleCount).map((paper, index) => (
              <li key={`${paper.collectionId}:${paper.relativePath}`}>
                {paper.state === 'ready' ? (
                  <Link
                    className="paper-row"
                    href={paperRoute(
                      paper.collectionId,
                      paper.relativePath,
                      query,
                    )}
                  >
                    <span className="paper-number">
                      {String(index + 1).padStart(3, '0')}
                    </span>
                    <span className="paper-identity">
                      <strong>{paper.title}</strong>
                      <code>{paper.fileName}</code>
                    </span>
                    <span className="paper-detail">{paper.detail}</span>
                    <span className="paper-count">
                      {paper.questionCount} questions
                    </span>
                    <span className="paper-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </Link>
                ) : (
                  <div className="paper-row paper-row--invalid">
                    <span className="paper-number">!</span>
                    <span className="paper-identity">
                      <strong>{paper.title}</strong>
                      <code>{paper.fileName}</code>
                    </span>
                    <span className="paper-detail">{paper.detail}</span>
                    <span className="paper-count">Invalid TOML</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        {visibleCount < matches.length ? (
          <button
            className="load-more"
            onClick={() => setVisibleCount((value) => value + PAGE_SIZE)}
            type="button"
          >
            Show {Math.min(PAGE_SIZE, matches.length - visibleCount)} more
          </button>
        ) : null}
      </div>
    </section>
  );
}
