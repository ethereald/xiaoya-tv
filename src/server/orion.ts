import { getCatalog, getDetail } from './source.js';
import type { CatalogItem, MediaDetail } from '../shared/types.js';

interface OrionItem {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
}

const titleIndex = new Map<string, CatalogItem[]>();

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function remember(items: CatalogItem[]): void {
  for (const item of items) {
    const key = normalized(item.title);
    const matches = titleIndex.get(key) || [];
    if (!matches.some((match) => match.id === item.id)) matches.push(item);
    titleIndex.set(key, matches);
  }
}

function categoryFor(type: string, tag: string): string {
  const movieTags: Record<string, string> = {
    '动作': '1001', '喜剧': '1002', '爱情': '1003', '科幻': '1004',
    '恐怖': '1005', '悬疑': '1016', '欧美': '1017',
  };
  if (type === 'movie') return movieTags[tag] || '10';
  if (tag === '综艺') return '12';
  if (tag.includes('动画') || tag.includes('动漫')) return '13';
  return '11';
}

export async function getOrionCatalog(
  type: string,
  tag: string,
  pageSize: number,
  pageStart: number,
  sourceOrigin?: string,
): Promise<{ code: number; message: string; list: Array<{ title: string; poster: string; rate: string }> }> {
  const safeSize = Math.max(1, Math.min(40, pageSize || 20));
  const page = Math.floor(Math.max(0, pageStart) / safeSize) + 1;
  const items = await getCatalog(categoryFor(type, tag), page, sourceOrigin);
  remember(items);
  return {
    code: 200,
    message: 'success',
    list: items.slice(0, safeSize).map((item) => ({ title: item.title, poster: item.poster, rate: '' })),
  };
}

async function findItems(query: string, sourceOrigin?: string): Promise<CatalogItem[]> {
  const key = normalized(query);
  const exact = titleIndex.get(key);
  if (exact?.length) return exact;

  const pages = await Promise.allSettled(
    ['10', '11', '12', '13'].flatMap((category) =>
      [1, 2, 3].map((page) => getCatalog(category, page, sourceOrigin)),
    ),
  );
  for (const result of pages) if (result.status === 'fulfilled') remember(result.value);

  const refreshed = titleIndex.get(key);
  if (refreshed?.length) return refreshed;
  return [...titleIndex.values()].flat().filter((item) => normalized(item.title).includes(key)).slice(0, 20);
}

function toOrionResult(detail: MediaDetail, requestOrigin: string): OrionItem {
  return {
    id: detail.id,
    title: detail.title,
    poster: detail.poster,
    episodes: detail.episodes.map((episode) =>
      `${requestOrigin}/api/relay/${encodeURIComponent(detail.id)}/${episode.index}/stream.m3u8?source=0`,
    ),
    source: 'xiaoya',
    source_name: '小鸭看看',
    class: detail.category,
    year: detail.year || '',
    desc: detail.description,
    type_name: detail.category,
  };
}

export async function searchOrion(
  query: string,
  requestOrigin: string,
  sourceOrigin?: string,
): Promise<{ results: OrionItem[] }> {
  const matches = await findItems(query, sourceOrigin);
  const details = await Promise.allSettled(matches.slice(0, 8).map((item) => getDetail(item.id, sourceOrigin)));
  return {
    results: details
      .filter((result): result is PromiseFulfilledResult<MediaDetail> => result.status === 'fulfilled')
      .map((result) => toOrionResult(result.value, requestOrigin)),
  };
}

export async function getOrionDetail(id: string, sourceOrigin?: string): Promise<Record<string, string>> {
  const detail = await getDetail(id, sourceOrigin);
  return {
    id: detail.id,
    title: detail.title,
    poster: detail.poster,
    source: 'xiaoya',
    source_name: '小鸭看看',
    desc: detail.description,
    type: detail.category,
    year: detail.year,
    area: '',
    director: '',
    actor: '',
    remarks: detail.quality,
  };
}
