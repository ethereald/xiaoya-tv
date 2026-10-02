import type { Context } from 'hono';

import { serveHlsAsTransportStream, VIRTUAL_TS_FILE_LENGTH } from './hls.js';
import { getCatalog, getCategories, getDetail } from './source.js';
import type { AppEnv } from './app.js';

interface DavEntry {
  name: string;
  directory: boolean;
}

function cleanName(value: string): string {
  return value.replace(/[\\/:*?"<>|%]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function decodedSegments(url: string): string[] {
  return new URL(url).pathname
    .replace(/^\/dav\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      let decoded = segment;
      for (let pass = 0; pass < 3; pass += 1) {
        try {
          const next = decodeURIComponent(decoded);
          if (next === decoded) break;
          decoded = next;
        } catch {
          break;
        }
      }
      return decoded;
    });
}

function token(segments: string[], expression: RegExp): RegExpMatchArray | undefined {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const match = segments[index].match(expression);
    if (match) return match;
  }
  return undefined;
}

function href(segments: string[], directory: boolean): string {
  const encoded = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return `${encoded ? `/dav/${encoded}` : '/dav'}${directory ? '/' : ''}`;
}

function responseXml(entryHref: string, entry: DavEntry): string {
  const modified = new Date().toUTCString();
  return `<d:response>
    <d:href>${xml(entryHref)}</d:href>
    <d:propstat><d:prop>
      <d:displayname>${xml(entry.name)}</d:displayname>
      <d:resourcetype>${entry.directory ? '<d:collection/>' : ''}</d:resourcetype>
      <d:getcontenttype>${entry.directory ? 'httpd/unix-directory' : 'video/mp2t'}</d:getcontenttype>
      <d:getcontentlength>${entry.directory ? 0 : VIRTUAL_TS_FILE_LENGTH}</d:getcontentlength>
      <d:getlastmodified>${modified}</d:getlastmodified>
      <d:creationdate>${new Date().toISOString()}</d:creationdate>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>`;
}

async function listEntries(segments: string[], sourceOrigin?: string): Promise<DavEntry[]> {
  const mediaMatch = token(segments, /\[m([a-f0-9]+)]/i);
  const episodeMatch = token(segments, /\[e(\d+)]/i);
  const categoryMatch = token(segments, /\[c(\d+)]/i);
  const pageMatch = token(segments, /\[p(\d+)]/i);

  if (mediaMatch && episodeMatch) {
    const detail = await getDetail(mediaMatch[1], sourceOrigin);
    const episode = detail.episodes[Number(episodeMatch[1])];
    if (!episode) return [];
    return episode.sources.slice(0, 20).map((source, sourceIndex) => ({
      name: `${cleanName(source.name)} ${sourceIndex + 1} [e${episode.index}s${sourceIndex}].ts`,
      directory: false,
    }));
  }

  if (mediaMatch) {
    const detail = await getDetail(mediaMatch[1], sourceOrigin);
    return detail.episodes.map((episode) => ({
      name: `${cleanName(episode.label)} [e${episode.index}]`,
      directory: true,
    }));
  }

  if (categoryMatch) {
    const page = Math.max(1, Number(pageMatch?.[1] || 1));
    const items = await getCatalog(categoryMatch[1], page, sourceOrigin);
    const entries: DavEntry[] = items.map((item) => ({
      name: `${cleanName(item.title)} [m${item.id}]`,
      directory: true,
    }));
    if (page > 1) entries.unshift({ name: `← 上一页 [p${page - 1}]`, directory: true });
    if (items.length >= 20) entries.push({ name: `下一页 → [p${page + 1}]`, directory: true });
    return entries;
  }

  return (await getCategories(sourceOrigin)).map((category) => ({
    name: `${cleanName(category.name)} [c${category.id}]`,
    directory: true,
  }));
}

function currentEntry(segments: string[]): DavEntry {
  return { name: segments[segments.length - 1] || '小鴨影視', directory: !token(segments, /\[e\d+s\d+]\.ts$/i) };
}

export async function handlePropfind(c: Context<AppEnv>, sourceOrigin?: string): Promise<Response> {
  try {
    const segments = decodedSegments(c.req.url);
    const current = currentEntry(segments);
    const responses = [responseXml(href(segments, current.directory), current)];
    if ((c.req.header('depth') || '1') !== '0' && current.directory) {
      const children = await listEntries(segments, sourceOrigin);
      for (const child of children) responses.push(responseXml(href([...segments, child.name], child.directory), child));
    }
    const body = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses.join('')}</d:multistatus>`;
    return c.body(body, 207, {
      'Content-Type': 'application/xml; charset=utf-8',
      DAV: '1',
      'Cache-Control': 'no-store',
    });
  } catch (error) {
    return c.text(error instanceof Error ? error.message : String(error), 502);
  }
}

export async function handleDavGet(c: Context<AppEnv>, sourceOrigin?: string): Promise<Response> {
  try {
    const segments = decodedSegments(c.req.url);
    const mediaMatch = token(segments, /\[m([a-f0-9]+)]/i);
    const streamMatch = token(segments, /\[e(\d+)s(\d+)]\.ts$/i);
    if (!mediaMatch || !streamMatch) return c.text('Use PROPFIND to browse this WebDAV directory', 405);
    const detail = await getDetail(mediaMatch[1], sourceOrigin);
    const sources = detail.episodes[Number(streamMatch[1])]?.sources;
    const selectedIndex = Number(streamMatch[2]);
    const selected = sources?.[selectedIndex];
    if (!selected) return c.text('Stream not found', 404);
    const candidates = [selected, ...sources!.filter((_source, index) => index !== selectedIndex)].map((source) => source.url);
    return serveHlsAsTransportStream(candidates, c.req.method);
  } catch (error) {
    return c.text(error instanceof Error ? error.message : String(error), 502);
  }
}
