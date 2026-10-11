import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, FileImage, Folder } from 'lucide-react';
import { createLibraryClient } from '@photomator/core';
import type { BrowseEntry, BrowseListing } from '@photomator/core';
import { Modal } from '@photomator/ui';

interface FsBrowserProps {
  title: string;
  subtitle: string;
  actionLabel: string;
  onClose: () => void;
  onSelect: (paths: string[]) => void;
}

// Browse the server's folders and pick files or folders to import. The server
// confines browsing to its allowed roots; selections import by reference.
export function FsBrowser({ title, subtitle, actionLabel, onClose, onSelect }: FsBrowserProps) {
  const client = useMemo(() => createLibraryClient(), []);
  const [path, setPath] = useState<string | undefined>(undefined);
  const [listing, setListing] = useState<BrowseListing | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void client.browse(path).then(
      (next) => {
        if (cancelled) return;
        setListing(next);
        setLoading(false);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'This folder could not be read.');
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, path]);

  const toggle = (entry: BrowseEntry) => {
    setSelected((current) =>
      current.includes(entry.path) ? current.filter((item) => item !== entry.path) : [...current, entry.path],
    );
  };

  const segments = (listing?.path ?? '').split('/').filter(Boolean);
  const crumbPath = (index: number): string => `/${segments.slice(0, index + 1).join('/')}`;

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} className="fs-modal">
      <nav className="fs-crumbs" aria-label="Current folder">
        {segments.map((segment, index) => (
          <span key={crumbPath(index)}>
            {index > 0 && <span className="fs-crumb-sep">/</span>}
            <button
              className={index === segments.length - 1 ? 'is-current' : ''}
              disabled={index === segments.length - 1}
              onClick={() => setPath(crumbPath(index))}
            >
              {segment}
            </button>
          </span>
        ))}
      </nav>
      <div className="fs-list" role="group" aria-label="Files and folders">
        {listing?.parent && (
          <button className="fs-row" onClick={() => setPath(listing.parent ?? undefined)}>
            <ChevronLeft size={14} />
            <span>..</span>
          </button>
        )}
        {listing?.entries.map((entry) =>
          entry.isDir ? (
            <div className="fs-row" key={entry.path}>
              <button className="fs-name" onClick={() => setPath(entry.path)} title={`Open ${entry.name}`}>
                <Folder size={15} />
                <span>{entry.name}</span>
              </button>
              <button
                className={`fs-check ${selected.includes(entry.path) ? 'is-checked' : ''}`}
                role="checkbox"
                aria-checked={selected.includes(entry.path)}
                aria-label={`Import the ${entry.name} folder`}
                title="Import this folder"
                onClick={() => toggle(entry)}
              >
                {selected.includes(entry.path) && <Check size={12} strokeWidth={3} />}
              </button>
            </div>
          ) : (
            <div className={`fs-row ${entry.importable ? '' : 'is-disabled'}`} key={entry.path}>
              <span className="fs-name" title={entry.name}>
                <FileImage size={15} />
                <span>{entry.name}</span>
              </span>
              {entry.importable && (
                <button
                  className={`fs-check ${selected.includes(entry.path) ? 'is-checked' : ''}`}
                  role="checkbox"
                  aria-checked={selected.includes(entry.path)}
                  aria-label={`Import ${entry.name}`}
                  onClick={() => toggle(entry)}
                >
                  {selected.includes(entry.path) && <Check size={12} strokeWidth={3} />}
                </button>
              )}
            </div>
          ),
        )}
        {!loading && !error && listing && !listing.entries.length && !listing.parent && (
          <p className="fs-empty">This folder is empty.</p>
        )}
        {!loading && !error && listing && !listing.entries.length && listing.parent && (
          <p className="fs-empty">No files here.</p>
        )}
        {loading && (
          <p className="fs-empty">
            <span className="loading-spinner small" aria-hidden="true" /> Reading folder…
          </p>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <span className="fs-count">{selected.length ? `${selected.length} selected` : 'Select files or folders'}</span>
        <button
          className="text-button"
          disabled={!listing || loading}
          title="Import everything importable in this folder"
          onClick={() => listing && onSelect([listing.path])}
        >
          This folder
        </button>
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-button" disabled={!selected.length} onClick={() => onSelect(selected)}>
          {actionLabel}
        </button>
      </div>
    </Modal>
  );
}
