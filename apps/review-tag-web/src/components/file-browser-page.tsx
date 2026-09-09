'use client';

import * as Popover from '@radix-ui/react-popover';
import { Check, FileText, Filter, FolderOpen, Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { FileCommandPalette } from '@/components/file-command-palette';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command-dialog';
import { Input } from '@/components/ui/input';
import { compareFolderKeys, folderLabel } from '@/lib/paper-folder-metadata';
import type { FileIndexItem, FolderKey } from '@/lib/paper-types';
import { cn } from '@/lib/utils';

type FolderFilter = 'all' | FolderKey;

type FileBrowserPageProps = {
  files: FileIndexItem[];
};

const STATUS_ORDER = [
  'notstarted',
  'blocked',
  'g0',
  'ng0',
  'ng1',
  'ng2',
  'ng3',
  'ng4',
  'ng5',
  'ng6',
  'ng7',
  'ng8',
] as const;

function compareStatusKeys(left: string, right: string) {
  const leftIndex = STATUS_ORDER.indexOf(left as (typeof STATUS_ORDER)[number]);
  const rightIndex = STATUS_ORDER.indexOf(
    right as (typeof STATUS_ORDER)[number],
  );

  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }

  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function matchesQuery(file: FileIndexItem, query: string) {
  if (!query) {
    return true;
  }

  const terms = query.split(/\s+/g).filter(Boolean);
  return terms.every(term => file.searchText.includes(term));
}

function MultiSelectFilter({
  emptyLabel,
  label,
  onToggle,
  options,
  selected,
}: {
  emptyLabel: string;
  label: string;
  onToggle: (value: string) => void;
  options: Array<{
    key: string;
    label: string;
    tone?: FileIndexItem['navStatusTone'];
  }>;
  selected: string[];
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="sm" type="button" variant="outline">
          <Filter className="h-3.5 w-3.5" />
          {label}
          {selected.length ? (
            <span className="browse-filter-pill__count">{selected.length}</span>
          ) : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          className="browse-filter-popover"
          sideOffset={10}>
          <Command>
            <CommandInput placeholder={`Filter ${label.toLowerCase()}…`} />
            <CommandList>
              <CommandEmpty>{emptyLabel}</CommandEmpty>
              <CommandGroup>
                {options.map(option => {
                  const isSelected = selected.includes(option.key);

                  return (
                    <CommandItem
                      key={option.key}
                      onSelect={() => onToggle(option.key)}
                      value={`${option.label} ${option.key}`}>
                      <Check
                        className={cn(
                          'h-4 w-4',
                          isSelected ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      {option.tone ? (
                        <Badge
                          className="shrink-0 text-[10px] tracking-[0.12em]"
                          tone={option.tone}>
                          {option.label}
                        </Badge>
                      ) : (
                        <span className="truncate">{option.label}</span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function FileBrowserPage({ files }: FileBrowserPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const folderOptions = useMemo(() => {
    const folderKeys = [...new Set(files.map(file => file.folderKey))].sort(
      compareFolderKeys,
    );

    return [
      { key: 'all' as const, label: 'All TOML' },
      ...folderKeys.map(folderKey => ({
        key: folderKey,
        label: folderLabel(folderKey),
      })),
    ];
  }, [files]);

  const requestedFolder = searchParams.get('folder');
  const folder: FolderFilter =
    requestedFolder &&
    folderOptions.some(option => option.key === requestedFolder)
      ? (requestedFolder as FolderFilter)
      : 'all';
  const query = searchParams.get('q') ?? '';
  const selectedFocusGroups = searchParams.getAll('focus');
  const selectedTopics = searchParams.getAll('topic');
  const selectedStates = searchParams.getAll('state');

  const visibleFolders =
    folder === 'all'
      ? folderOptions
          .filter(option => option.key !== 'all')
          .map(option => option.key)
      : ([folder] as FolderKey[]);

  const availableTopicOptions = (() => {
    const byKey = new Map<string, string>();

    for (const file of files) {
      if (!visibleFolders.includes(file.folderKey)) {
        continue;
      }

      if (!file.navTopicKey || !file.navTopicLabel) {
        continue;
      }

      byKey.set(file.navTopicKey, file.navTopicLabel);
    }

    return [...byKey.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((left, right) =>
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );
  })();

  const availableFocusGroupOptions = (() => {
    const byKey = new Map<string, string>();

    for (const file of files) {
      if (!visibleFolders.includes(file.folderKey)) {
        continue;
      }

      for (const focusGroup of file.navFocusGroups) {
        byKey.set(focusGroup, focusGroup);
      }
    }

    return [...byKey.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((left, right) =>
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );
  })();

  const availableStateOptions = (() => {
    const byKey = new Map<
      string,
      { label: string; tone: FileIndexItem['navStatusTone'] }
    >();

    for (const file of files) {
      if (!visibleFolders.includes(file.folderKey)) {
        continue;
      }

      if (!file.navStatusKey || !file.navStatus) {
        continue;
      }

      byKey.set(file.navStatusKey, {
        label: file.navStatus,
        tone: file.navStatusTone,
      });
    }

    return [...byKey.entries()]
      .map(([key, value]) => ({ key, label: value.label, tone: value.tone }))
      .sort((left, right) => compareStatusKeys(left.key, right.key));
  })();

  const visibleFiles = files.filter(file => {
    if (!visibleFolders.includes(file.folderKey)) {
      return false;
    }

    if (
      selectedTopics.length &&
      (!file.navTopicKey || !selectedTopics.includes(file.navTopicKey))
    ) {
      return false;
    }

    if (
      selectedFocusGroups.length &&
      !selectedFocusGroups.some(value => file.navFocusGroups.includes(value))
    ) {
      return false;
    }

    if (
      selectedStates.length &&
      (!file.navStatusKey || !selectedStates.includes(file.navStatusKey))
    ) {
      return false;
    }

    return matchesQuery(file, query.trim().toLowerCase());
  });

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const setFolder = (nextFolder: FolderFilter) =>
    updateParams(params => {
      if (nextFolder === 'all') {
        params.delete('folder');
      } else {
        params.set('folder', nextFolder);
      }
    });

  const setQuery = (nextQuery: string) =>
    updateParams(params => {
      if (nextQuery.trim()) {
        params.set('q', nextQuery);
      } else {
        params.delete('q');
      }
    });

  const toggleMultiParam = (key: 'focus' | 'state' | 'topic', value: string) =>
    updateParams(params => {
      const current = new Set(params.getAll(key));

      if (current.has(value)) {
        current.delete(value);
      } else {
        current.add(value);
      }

      params.delete(key);
      [...current]
        .sort((left, right) =>
          left.localeCompare(right, undefined, {
            numeric: true,
            sensitivity: 'base',
          }),
        )
        .forEach(entry => params.append(key, entry));
    });

  const clearFilters = () =>
    updateParams(params => {
      params.delete('q');
      params.delete('focus');
      params.delete('topic');
      params.delete('state');
    });

  return (
    <div className="browse-shell">
      <header className="browse-hero">
        <div>
          <p className="tag-sidebar__eyebrow">Workspace</p>
          <h1>RTQ Tag Editor</h1>
          <p className="browse-hero__subtitle">
            Filter papers by folder, topic, and RAG state, then jump into a
            single TOML file for inline tagging.
          </p>
        </div>
        <div className="browse-hero__actions">
          <div className="tag-sidebar__hint">
            <span>Jump fast with</span>
            <kbd>Cmd K</kbd>
          </div>
          <FileCommandPalette files={visibleFiles} />
        </div>
      </header>

      <section className="browse-filters">
        <div
          className="tag-sidebar__filters"
          role="tablist"
          aria-label="Source bucket">
          {folderOptions.map(option => (
            <button
              aria-selected={folder === option.key}
              className={cn(
                'tag-sidebar__filter',
                folder === option.key && 'tag-sidebar__filter--active',
              )}
              key={option.key}
              onClick={() => setFolder(option.key)}
              role="tab"
              type="button">
              {option.label}
            </button>
          ))}
        </div>

        <div className="browse-filters__row">
          <label className="browse-search">
            <Search className="h-4 w-4 text-[color:var(--muted)]" />
            <Input
              onChange={event => setQuery(event.target.value)}
              placeholder="Search by school, topic, filename, or state…"
              value={query}
            />
          </label>

          {availableTopicOptions.length ? (
            <MultiSelectFilter
              emptyLabel="No topic matches."
              label="Topics"
              onToggle={value => toggleMultiParam('topic', value)}
              options={availableTopicOptions}
              selected={selectedTopics}
            />
          ) : null}

          {availableFocusGroupOptions.length ? (
            <MultiSelectFilter
              emptyLabel="No focus-group matches."
              label="Focus groups"
              onToggle={value => toggleMultiParam('focus', value)}
              options={availableFocusGroupOptions}
              selected={selectedFocusGroups}
            />
          ) : null}

          {availableStateOptions.length ? (
            <MultiSelectFilter
              emptyLabel="No state matches."
              label="RAG states"
              onToggle={value => toggleMultiParam('state', value)}
              options={availableStateOptions}
              selected={selectedStates}
            />
          ) : null}

          {query ||
          selectedTopics.length ||
          selectedFocusGroups.length ||
          selectedStates.length ? (
            <Button
              onClick={clearFilters}
              size="sm"
              type="button"
              variant="ghost">
              Clear
            </Button>
          ) : null}
        </div>

        {selectedTopics.length ||
        selectedFocusGroups.length ||
        selectedStates.length ? (
          <div className="browse-active-filters">
            {selectedTopics.map(topic => {
              const option = availableTopicOptions.find(
                entry => entry.key === topic,
              );
              return (
                <button
                  className="browse-active-filter"
                  key={`topic-${topic}`}
                  onClick={() => toggleMultiParam('topic', topic)}
                  type="button">
                  Topic: {option?.label ?? topic}
                  <X className="h-3.5 w-3.5" />
                </button>
              );
            })}
            {selectedFocusGroups.map(focusGroup => {
              const option = availableFocusGroupOptions.find(
                entry => entry.key === focusGroup,
              );
              return (
                <button
                  className="browse-active-filter"
                  key={`focus-${focusGroup}`}
                  onClick={() => toggleMultiParam('focus', focusGroup)}
                  type="button">
                  Focus: {option?.label ?? focusGroup}
                  <X className="h-3.5 w-3.5" />
                </button>
              );
            })}
            {selectedStates.map(state => {
              const option = availableStateOptions.find(
                entry => entry.key === state,
              );
              return (
                <button
                  className="browse-active-filter"
                  key={`state-${state}`}
                  onClick={() => toggleMultiParam('state', state)}
                  type="button">
                  State: {option?.label ?? state}
                  <X className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="browse-results">
        <div className="browse-results__meta">
          <div className="browse-results__summary">
            <span>{visibleFiles.length} files</span>
            <span>·</span>
            <span>
              {folder === 'all' ? 'All folders' : folderLabel(folder)}
            </span>
          </div>
        </div>

        <div className="browse-results__table">
          {visibleFiles.map(file => (
            <Link
              className="browse-row"
              href={file.href}
              key={`${file.folderKey}:${file.relativePath}`}>
              <div className="browse-row__main">
                <div className="browse-row__title-line">
                  <FileText className="h-4 w-4 shrink-0 text-[color:var(--accent)]" />
                  <span className="browse-row__title">{file.navTitle}</span>
                </div>
                <div className="browse-row__meta">
                  <span>{file.navMeta}</span>
                  <span>·</span>
                  <span>{folderLabel(file.folderKey)}</span>
                  <span>·</span>
                  <span className="browse-row__path">{file.relativePath}</span>
                </div>
              </div>

              <div className="browse-row__tags">
                <Badge
                  className="shrink-0 px-3.5 py-1 text-[20px] leading-none tracking-[0]"
                  tone="marker">
                  <span
                    aria-label={`${file.questionCount} ${file.questionCount === 1 ? 'question' : 'questions'}`}>
                    {file.questionCount}
                  </span>
                </Badge>
                {file.navTopicLabel ? (
                  <span className="browse-row__topic">
                    <FolderOpen className="h-3.5 w-3.5" />
                    {file.navTopicLabel}
                  </span>
                ) : null}
                {file.navFocusGroups.map(focusGroup => (
                  <span
                    className="browse-row__topic"
                    key={`${file.folderKey}:${file.relativePath}:focus:${focusGroup}`}>
                    {focusGroup}
                  </span>
                ))}
                {file.navStatus ? (
                  <Badge
                    className="shrink-0 text-[10px] tracking-[0.14em]"
                    tone={file.navStatusTone ?? 'status'}>
                    {file.navStatus}
                  </Badge>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
