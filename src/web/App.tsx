import Hls from 'hls.js';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { CatalogItem, Category, MediaDetail } from '../shared/types';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface Playback {
  id: string;
  episode: number;
  title: string;
  url: string;
  startPosition: number;
}

interface SearchResult {
  id: string;
  title: string;
  poster: string;
  desc?: string;
  year?: string;
  type_name?: string;
}

const FAVORITES_KEY = 'xiaoya:web:favorites';
const HISTORY_KEY = 'xiaoya:web:history';

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function readFavorites(): CatalogItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item) => item && typeof item.id === 'string') : [];
  } catch {
    return [];
  }
}

function readHistory(): CatalogItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item) => item && typeof item.id === 'string') : [];
  } catch {
    return [];
  }
}

function progressKey(id: string, episode: number) {
  return `xiaoya:web:progress:${id}:${episode}`;
}

function readProgress(id: string, episode: number): number {
  const value = Number(localStorage.getItem(progressKey(id, episode)) || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState('10');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [searchResults, setSearchResults] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState<CatalogItem[]>(readFavorites);
  const [history, setHistory] = useState<CatalogItem[]>(readHistory);
  const [view, setView] = useState<'catalog' | 'favorites' | 'history' | 'search'>('catalog');
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [episode, setEpisode] = useState(0);
  const [source, setSource] = useState(0);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    api<{ categories: Category[] }>('/api/categories')
      .then(({ categories: value }) => setCategories(value))
      .catch((reason) => setError(reason.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    api<{ items: CatalogItem[] }>(`/api/catalog?category=${category}&page=${page}`)
      .then(({ items: value }) => setItems(value))
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [category, page]);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playback) return;
    let hls: Hls | null = null;
    const start = () => {
      if (playback.startPosition > 0) video.currentTime = playback.startPosition;
      void video.play().catch(() => undefined);
    };
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playback.url;
      video.addEventListener('loadedmetadata', start, { once: true });
    } else if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(playback.url);
      hls.attachMedia(video);
      hls.once(Hls.Events.MANIFEST_PARSED, start);
    } else {
      setError('此瀏覽器不支援 HLS 播放。');
    }
    return () => {
      video.removeEventListener('loadedmetadata', start);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [playback]);

  const relayUrl = useMemo(() => {
    if (!detail) return '';
    return `${window.location.origin}/api/relay/${detail.id}/${episode}/stream.m3u8?source=${source}`;
  }, [detail, episode, source]);

  const groupCategories = useMemo(() => categories.filter((entry) => entry.id.length === 2), [categories]);
  const activeGroup = useMemo(() => (
    groupCategories.find((entry) => category === entry.id || category.startsWith(entry.id))?.id
      || groupCategories[0]?.id
      || '10'
  ), [categories, category, groupCategories]);
  const subcategories = useMemo(() => categories.filter((entry) => (
    entry.id === activeGroup || (entry.id.length > 2 && entry.id.startsWith(activeGroup))
  )), [activeGroup, categories]);
  const displayedItems = view === 'favorites'
    ? favorites
    : view === 'history'
      ? history
      : view === 'search'
        ? searchResults
        : items;
  const isFavorite = detail ? favorites.some((item) => item.id === detail.id) : false;
  const selectedEpisode = detail?.episodes[episode];

  async function show(item: CatalogItem) {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ detail: MediaDetail }>(`/api/media/${item.id}`);
      setDetail(result.detail);
      setEpisode(0);
      setSource(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) {
      setView('catalog');
      return;
    }
    setView('search');
    setLoading(true);
    setError('');
    try {
      const response = await api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(value)}`);
      setSearchResults(response.results.map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.poster,
        quality: item.year || '',
        category: item.type_name || '',
        description: item.desc || '',
      })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  function toggleFavorite() {
    if (!detail) return;
    const next = isFavorite
      ? favorites.filter((item) => item.id !== detail.id)
      : [{
          id: detail.id,
          title: detail.title,
          poster: detail.poster,
          quality: detail.quality,
          category: detail.category,
          description: detail.description,
        }, ...favorites];
    setFavorites(next);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }

  function playWeb() {
    if (!detail || !relayUrl) return;
    const historyItem: CatalogItem = {
      id: detail.id,
      title: detail.title,
      poster: detail.poster,
      quality: detail.quality,
      category: detail.category,
      description: detail.description,
    };
    const nextHistory = [historyItem, ...history.filter((item) => item.id !== detail.id)].slice(0, 80);
    setHistory(nextHistory);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    const saved = readProgress(detail.id, episode);
    const resume = saved > 10
      ? window.confirm(`上次播放至 ${formatTime(saved)}。\n\n確定：繼續播放\n取消：從頭播放`)
      : false;
    if (!resume) localStorage.removeItem(progressKey(detail.id, episode));
    setPlayback({
      id: detail.id,
      episode,
      title: `${detail.title} · ${selectedEpisode?.label || `第 ${episode + 1} 集`}`,
      url: relayUrl,
      startPosition: resume ? saved : 0,
    });
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
      return;
    }
    alert('Android Chrome：開啟右上角選單，選擇「加到主畫面」或「安裝應用程式」。\n\niPhone/iPad Safari：按分享按鈕，再選擇「加入主畫面」。');
  }

  function saveProgress() {
    const video = videoRef.current;
    if (!video || !playback || !Number.isFinite(video.currentTime)) return;
    if (video.duration > 0 && video.currentTime >= video.duration - 20) {
      localStorage.removeItem(progressKey(playback.id, playback.episode));
    } else if (video.currentTime > 2) {
      localStorage.setItem(progressKey(playback.id, playback.episode), String(video.currentTime));
    }
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>小鴨影視</h1>
          <p>可安裝的網頁播放器 · 收藏及播放進度保存在此裝置</p>
        </div>
        <div className="header-actions">
          <button className="header-button" onClick={() => setView(view === 'favorites' ? 'catalog' : 'favorites')}>
            {view === 'favorites' ? '返回影片' : `我的收藏 (${favorites.length})`}
          </button>
          <button className="header-button" onClick={() => setView(view === 'history' ? 'catalog' : 'history')}>
            {view === 'history' ? '返回影片' : `播放記錄 (${history.length})`}
          </button>
          <button className="header-button" onClick={() => void installApp()}>加入主畫面</button>
          <a className="download" href="/xiaoya-tv.apk?v=0.6.0" download>下載 Android TV 應用程式</a>
        </div>
      </header>

      <section className="browse-tools">
        <form className="search-form" onSubmit={(event) => void search(event)}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋片名" aria-label="搜尋片名" />
          <button type="submit">搜尋</button>
          {view === 'search' && <button type="button" onClick={() => setView('catalog')}>返回分類</button>}
        </form>

        {view === 'catalog' && (
          <div className="category-controls" aria-label="影片分類">
            <label>
              主分類
              <select value={activeGroup} onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}>
                {groupCategories.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
              </select>
            </label>
            <label>
              子分類
              <select value={category} onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}>
                {subcategories.map((entry) => (
                  <option value={entry.id} key={entry.id}>{entry.id === activeGroup ? `全部${entry.name}` : entry.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </section>

      {view === 'favorites' && <h2 className="section-title">我的收藏</h2>}
      {view === 'history' && (
        <div className="section-title-row">
          <h2 className="section-title">播放記錄</h2>
          {history.length > 0 && <button onClick={() => {
            if (window.confirm('確定要清除全部播放記錄及網頁播放進度嗎？')) {
              setHistory([]);
              localStorage.removeItem(HISTORY_KEY);
              Object.keys(localStorage).filter((key) => key.startsWith('xiaoya:web:progress:'))
                .forEach((key) => localStorage.removeItem(key));
            }
          }}>清除全部</button>}
        </div>
      )}
      {view === 'search' && <h2 className="section-title">搜尋結果：{query.trim()}</h2>}
      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">載入中…</div>}
      {!loading && view === 'favorites' && favorites.length === 0 && <div className="loading">尚未收藏影片</div>}
      {!loading && view === 'history' && history.length === 0 && <div className="loading">尚無播放記錄</div>}
      {!loading && view === 'search' && searchResults.length === 0 && <div className="loading">找不到相關影片</div>}

      <main className="grid">
        {displayedItems.map((item) => (
          <button className="card" key={item.id} onClick={() => void show(item)}>
            <img src={item.poster} alt="" loading="lazy" referrerPolicy="no-referrer" />
            {item.quality && <span className="quality">{item.quality}</span>}
            <strong>{item.title}</strong>
            <small>{item.category}</small>
          </button>
        ))}
      </main>

      {view === 'catalog' && (
        <footer className="pager">
          <button disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← 上一頁</button>
          <span>第 {page} 頁</span>
          <button onClick={() => setPage((value) => value + 1)}>下一頁 →</button>
        </footer>
      )}

      {detail && (
        <div className="backdrop" role="presentation" onClick={() => setDetail(null)}>
          <section className="detail" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button className="close" aria-label="關閉" onClick={() => setDetail(null)}>×</button>
            <img className="poster" src={detail.poster} alt="" referrerPolicy="no-referrer" />
            <div className="detail-content">
              <h2>{detail.title}</h2>
              <p className="meta">{[detail.category, detail.year].filter(Boolean).join(' · ')}</p>
              <p>{detail.description}</p>
              <label>
                選集
                <select value={episode} onChange={(event) => { setEpisode(Number(event.target.value)); setSource(0); }}>
                  {detail.episodes.map((entry) => <option value={entry.index} key={entry.index}>{entry.label}</option>)}
                </select>
              </label>
              <label>
                來源
                <select value={source} onChange={(event) => setSource(Number(event.target.value))}>
                  {selectedEpisode?.sources.map((entry, index) => <option value={index} key={entry.id}>{entry.name} · {index + 1}</option>)}
                </select>
              </label>
              <div className="actions">
                <button className="primary" onClick={playWeb}>播放</button>
                <button onClick={toggleFavorite}>{isFavorite ? '★ 取消收藏' : '☆ 加入收藏'}</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {playback && (
        <div className="player-backdrop">
          <section className="web-player">
            <div className="player-heading">
              <strong>{playback.title}</strong>
              <button onClick={() => { saveProgress(); setPlayback(null); }}>關閉</button>
            </div>
            <video ref={videoRef} controls playsInline onTimeUpdate={saveProgress} onPause={saveProgress} onEnded={saveProgress} />
          </section>
        </div>
      )}
    </div>
  );
}
