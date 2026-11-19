import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FlaskConical, Plus, Search } from 'lucide-react';
import { Api, type Study } from './api';

export function StudyLibrary({
  api,
  openStudy,
  createStudy,
}: {
  api: Api;
  openStudy: (id: string) => void;
  createStudy: () => void;
}) {
  const [studies, setStudies] = useState<Study[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [reload, setReload] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    const timeout = setTimeout(
      () =>
        api
          .studies(search, 0, controller.signal)
          .then((data) => {
            if (controller.signal.aborted) return;
            setStudies(data);
            setHasMore(data.length === 50);
            setLoading(false);
          })
          .catch((error) => {
            if (!controller.signal.aborted) {
              setError(error.message);
              setLoading(false);
            }
          }),
      200,
    );
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [api, search, reload]);

  async function more() {
    const signal = request.current?.signal;
    setLoading(true);
    setError('');
    try {
      const data = await api.studies(search, studies.length, signal);
      if (!signal?.aborted) {
        setStudies([...studies, ...data]);
        setHasMore(data.length === 50);
      }
    } catch (error) {
      if (!signal?.aborted)
        setError(error instanceof Error ? error.message : 'Could not load studies.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  return (
    <div className="page library-page">
      <div className="page-heading">
        <div>
          <h1>Study library</h1>
        </div>
        <button className="button primary" onClick={createStudy}>
          <Plus size={18} /> New study
        </button>
      </div>
      <div className="library-toolbar">
        <h2>Your studies</h2>
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search studies"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title"
            maxLength={250}
          />
        </label>
      </div>
      {error && (
        <div role="alert" className="alert error">
          {error}{' '}
          <button className="text-button" onClick={() => setReload(reload + 1)}>
            Try again
          </button>
        </div>
      )}
      {loading && studies.length === 0 ? (
        <div className="empty-state">
          <div className="spinner" />
          <p>Loading studies…</p>
        </div>
      ) : !studies.length && !error ? (
        <div className="empty-state">
          <div className="empty-icon">
            <FlaskConical size={30} strokeWidth={1.5} />
          </div>
          <h2>{search ? 'No studies match your search' : 'Your next study starts here'}</h2>
          <p>
            {search
              ? 'Try another title or clear the search.'
              : 'Give your study a name, then add a test and preview the experience.'}
          </p>
          {search ? (
            <button className="button secondary" onClick={() => setSearch('')}>
              Clear search
            </button>
          ) : (
            <button className="button primary" onClick={createStudy}>
              <Plus size={17} /> Create your first study
            </button>
          )}
        </div>
      ) : (
        <div className="study-list" aria-busy={loading}>
          {studies.map((study) => {
            const latest = study.versions.at(-1)!;
            return (
              <button
                className="study-list-row"
                key={study.id}
                onClick={() => openStudy(study.id)}
                disabled={loading}
              >
                <div className="study-list-status">
                  <span className="study-icon">
                    <FlaskConical size={20} />
                  </span>
                  <span className={`pill ${latest.published_at ? 'published' : 'draft'}`}>
                    {latest.published_at ? 'Published' : 'Draft'}
                  </span>
                </div>
                <h3>{study.title}</h3>
                <p>{study.description || '—'}</p>
                <div className="study-list-meta">
                  <span>
                    Version {latest.version_number} <span className="separator">·</span>{' '}
                    {new Date(study.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                  <ArrowRight size={18} />
                </div>
              </button>
            );
          })}
        </div>
      )}
      {hasMore && (
        <div className="load-more">
          <button className="button secondary" disabled={loading} onClick={more}>
            {loading ? 'Loading…' : 'Load more studies'}
          </button>
        </div>
      )}
    </div>
  );
}
