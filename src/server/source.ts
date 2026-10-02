import type {
  CatalogItem,
  Category,
  Episode,
  MediaDetail,
  StreamSource,
} from '../shared/types.js';

const DEFAULT_ORIGIN = 'https://xiaoyakankan.com';
const USER_AGENT =
  'Mozilla/5.0 (Android TV; XiaoyaTV/0.1) AppleWebKit/537.36 Chrome/124 Safari/537.36';

type CacheEntry<T> = { expires: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();

function origin(sourceOrigin = DEFAULT_ORIGIN): string {
  return sourceOrigin.replace(/\/$/, '');
}

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { expires: Date.now() + ttlMs, value });
  return value;
}

async function getHtml(path: string, sourceOrigin?: string): Promise<string> {
  const response = await fetch(`${origin(sourceOrigin)}${path}`, {
    headers: { accept: 'text/html', 'user-agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  return response.text();
}

export function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (_, entity: string) => {
      if (entity[0] === '#') {
        const hex = entity[1]?.toLowerCase() === 'x';
        return String.fromCodePoint(parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
      }
      return named[entity.toLowerCase()] ?? `&${entity};`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(value: string, sourceOrigin?: string): string {
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  return new URL(value, `${origin(sourceOrigin)}/`).toString();
}

export function parseCategories(html: string): Category[] {
  const categories = new Map<string, Category>();
  for (const match of html.matchAll(/<a[^>]+href="\/cat\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g)) {
    const name = decodeHtml(match[2]);
    if (name && !name.startsWith('全部')) categories.set(match[1], { id: match[1], name });
  }
  return [...categories.values()];
}

export function parseCatalog(html: string, sourceOrigin?: string): CatalogItem[] {
  const items: CatalogItem[] = [];
  const pattern = /<div class="item">[\s\S]*?<a class="link" href="\/post\/([a-f0-9]+)\.html">[\s\S]*?<img[^>]+data-src="([^"]+)"[^>]+alt="([^"]*)">[\s\S]*?<div class="tag1[^"]*">([\s\S]*?)<\/div>\s*<div class="tag2">([\s\S]*?)<\/div>[\s\S]*?<div class="info">[\s\S]*?<a class="title"[^>]*>([\s\S]*?)<\/a>\s*<div class="desc">([\s\S]*?)<\/div>/g;
  for (const match of html.matchAll(pattern)) {
    items.push({
      id: match[1],
      poster: absoluteUrl(match[2], sourceOrigin),
      title: decodeHtml(match[6] || match[3]),
      quality: decodeHtml(match[4]),
      category: decodeHtml(match[5]),
      description: decodeHtml(match[7]),
    });
  }
  return items;
}

type RawLine = [string, string, number, string[]];
type PlayerPayload = { no: string; lines: RawLine[] };

function parseEpisodeLabels(html: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const blocks = /<div data-vod="([\d_]+)" class="source">([\s\S]*?)(?=<div data-vod=|<div class="m4-info">)/g;
  for (const block of html.matchAll(blocks)) {
    const labels = [...block[2].matchAll(/<a data-sou_idx="\d+">([\s\S]*?)<\/a>/g)].map((m) =>
      decodeHtml(m[1]),
    );
    result.set(block[1], labels);
  }
  return result;
}

export function parseDetail(html: string, expectedId: string, sourceOrigin?: string): MediaDetail {
  const playerMatch = html.match(/<script>\s*var pp=(\{[\s\S]*?\});\s*<\/script>/);
  if (!playerMatch) throw new Error('The source page did not contain player data');
  const payload = JSON.parse(playerMatch[1]) as PlayerPayload;
  if (payload.no !== expectedId || !Array.isArray(payload.lines)) throw new Error('Invalid player data');

  const player = html.match(/<div id="awp1"[^>]*data-poster="([^"]*)"[^>]*data-title="([^"]*)"/);
  const description = html.match(/<meta name="description" content="([^"]*)"/);
  const category = html.match(/<div class="tag2">([\s\S]*?)<\/div>/);
  const year = html.match(/([12]\d{3})年/);
  const labels = parseEpisodeLabels(html);
  const episodeCount = Math.max(1, ...payload.lines.map((line) => line[2] || line[3]?.length || 0));
  const episodes: Episode[] = [];

  for (let index = 0; index < episodeCount; index += 1) {
    const sources: StreamSource[] = [];
    const seen = new Set<string>();
    let label = episodeCount === 1 ? '正片' : `第${index + 1}集`;
    for (const line of payload.lines) {
      const url = line[3]?.[index];
      if (!url || seen.has(url) || !/^https?:\/\//i.test(url)) continue;
      seen.add(url);
      label = labels.get(line[0])?.[index] || label;
      sources.push({ id: line[0], name: decodeHtml(line[1]), url });
    }
    if (sources.length) episodes.push({ index, label, sources });
  }

  return {
    id: expectedId,
    title: decodeHtml(player?.[2] || expectedId),
    poster: absoluteUrl(player?.[1] || '', sourceOrigin),
    quality: '',
    category: decodeHtml(category?.[1] || ''),
    description: decodeHtml(description?.[1] || ''),
    year: year?.[1] || '',
    episodes,
  };
}

export async function getCategories(sourceOrigin?: string): Promise<Category[]> {
  return cached(`categories:${origin(sourceOrigin)}`, 6 * 60 * 60_000, async () =>
    parseCategories(await getHtml('/', sourceOrigin)),
  );
}

export async function getCatalog(category = '10', page = 1, sourceOrigin?: string): Promise<CatalogItem[]> {
  if (!/^\d+$/.test(category) || page < 1 || page > 9999) throw new Error('Invalid category or page');
  const path = page === 1 ? `/cat/${category}.html` : `/cat/${category}-${page}.html`;
  return cached(`catalog:${origin(sourceOrigin)}:${category}:${page}`, 10 * 60_000, async () =>
    parseCatalog(await getHtml(path, sourceOrigin), sourceOrigin),
  );
}

export async function getDetail(id: string, sourceOrigin?: string): Promise<MediaDetail> {
  if (!/^[a-f0-9]{6,20}$/.test(id)) throw new Error('Invalid media id');
  return cached(`detail:${origin(sourceOrigin)}:${id}`, 10 * 60_000, async () =>
    parseDetail(await getHtml(`/post/${id}.html`, sourceOrigin), id, sourceOrigin),
  );
}
