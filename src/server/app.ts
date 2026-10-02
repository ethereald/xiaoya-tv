import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';

import { findPlayableHlsUrl, serveProxiedHlsResource } from './hls.js';
import { getOrionCatalog, getOrionDetail, searchOrion } from './orion.js';
import { getCatalog, getCategories, getDetail } from './source.js';
import { handleDavGet, handlePropfind } from './webdav.js';

export interface AppEnv {
  Bindings: {
    SOURCE_ORIGIN?: string;
  };
}

export const app = new Hono<AppEnv>();
const recentDavRequests: Array<{ method: string; path: string; at: string }> = [];
const recentRequests: Array<{ method: string; path: string; at: string; userAgent: string }> = [];
const recentCrashes: Array<Record<string, unknown> & { receivedAt: string }> = [];

function sourceOrigin(c: { env?: AppEnv['Bindings'] }): string | undefined {
  if (c.env?.SOURCE_ORIGIN) return c.env.SOURCE_ORIGIN;
  return typeof process !== 'undefined' ? process.env.SOURCE_ORIGIN : undefined;
}

function publicOrigin(c: Context<AppEnv>): string {
  const requestUrl = new URL(c.req.url);
  const forwardedProtocol = c.req.header('x-forwarded-proto')?.split(',')[0].trim().toLowerCase();
  const forwardedHost = c.req.header('x-forwarded-host')?.split(',')[0].trim() || c.req.header('host');
  if (forwardedProtocol === 'http' || forwardedProtocol === 'https') requestUrl.protocol = `${forwardedProtocol}:`;
  if (forwardedHost) requestUrl.host = forwardedHost;
  return requestUrl.origin;
}

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
  maxAge: 86_400,
}));

app.use('*', async (c, next) => {
  recentRequests.push({
    method: c.req.method,
    path: new URL(c.req.url).pathname + new URL(c.req.url).search,
    at: new Date().toISOString(),
    userAgent: c.req.header('user-agent') || '',
  });
  if (recentRequests.length > 80) recentRequests.shift();
  await next();
});

app.use('/dav/*', async (c, next) => {
  recentDavRequests.push({ method: c.req.method, path: new URL(c.req.url).pathname, at: new Date().toISOString() });
  if (recentDavRequests.length > 30) recentDavRequests.shift();
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true, stateless: true }));
app.get('/api/debug/dav', (c) => c.json({ requests: recentDavRequests }));
app.get('/api/debug/requests', (c) => c.json({ requests: recentRequests }));
app.get('/api/debug/crashes', (c) => c.json({ crashes: recentCrashes }));
app.post('/api/debug/crash', async (c) => {
  try {
    const report = await c.req.json<Record<string, unknown>>();
    recentCrashes.push({ ...report, receivedAt: new Date().toISOString() });
    if (recentCrashes.length > 20) recentCrashes.shift();
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: 'Invalid crash report' }, 400);
  }
});

app.get('/api/server-config', (c) => c.json({ SiteName: '小鸭看看', StorageType: 'localstorage' }));
app.post('/api/login', (c) => c.json({ ok: true }, 200, {
  'Set-Cookie': 'xiaoya_orion=local; Path=/; Max-Age=31536000; SameSite=Lax',
}));
app.post('/api/logout', (c) => c.json({ ok: true }));

app.get('/api/douban', async (c) => {
  try {
    return c.json(await getOrionCatalog(
      c.req.query('type') || 'movie',
      c.req.query('tag') || '',
      Number(c.req.query('pageSize') || 20),
      Number(c.req.query('pageStart') || 0),
      sourceOrigin(c),
    ));
  } catch (error) {
    return c.json({ code: 502, message: error instanceof Error ? error.message : String(error), list: [] }, 502);
  }
});

app.get('/api/search/resources', (c) => c.json([
  { key: 'xiaoya', api: publicOrigin(c), name: '小鸭看看' },
]));

app.on('GET', ['/api/search', '/api/search/one'], async (c) => {
  try {
    const resource = c.req.query('resourceId');
    if (resource && resource !== 'xiaoya') return c.json({ results: [] });
    return c.json(await searchOrion(c.req.query('q') || '', publicOrigin(c), sourceOrigin(c)));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error), results: [] }, 502);
  }
});

app.get('/api/detail', async (c) => {
  try {
    if (c.req.query('source') !== 'xiaoya') return c.json({ error: 'Unknown source' }, 404);
    return c.json(await getOrionDetail(c.req.query('id') || '', sourceOrigin(c)));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
});

app.get('/api/image-proxy', async (c) => {
  try {
    const url = new URL(c.req.query('url') || '');
    if (!['http:', 'https:'].includes(url.protocol)) return c.text('Invalid image URL', 400);
    if (url.hostname !== 'xiaoyakankan.com' && !url.hostname.endsWith('.xiaoyakankan.com')) {
      return c.text('Image host is not allowed', 403);
    }
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return c.text('Image fetch failed', 502);
    return new Response(response.body, {
      headers: {
        'Content-Type': response.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return c.text('Invalid image URL', 400);
  }
});

app.on(['GET', 'HEAD'], '/api/hls-proxy', (c) => {
  const url = c.req.query('url');
  if (!url) return c.text('Missing stream URL', 400);
  const proxyBase = `${publicOrigin(c)}/api/hls-proxy`;
  return serveProxiedHlsResource(url, proxyBase, c.req.method, c.req.header('range'));
});

app.get('/orion.m3u', (c) => {
  const target = new URL('/api/playlist.m3u?category=10', c.req.url);
  return app.fetch(new Request(target, { headers: c.req.raw.headers }), c.env);
});

app.on('OPTIONS', ['/dav', '/dav/', '/dav/*'], (c) =>
  c.body(null, 204, { Allow: 'OPTIONS, PROPFIND, GET, HEAD', DAV: '1' }),
);
app.on('PROPFIND', ['/dav', '/dav/', '/dav/*'], (c) => handlePropfind(c, sourceOrigin(c)));
app.on(['GET', 'HEAD'], ['/dav', '/dav/', '/dav/*'], (c) => handleDavGet(c, sourceOrigin(c)));

app.get('/api/categories', async (c) => {
  try {
    return c.json({ categories: await getCategories(sourceOrigin(c)) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
});

app.get('/api/catalog', async (c) => {
  try {
    const category = c.req.query('category') || '10';
    const page = Number(c.req.query('page') || 1);
    const items = await getCatalog(category, page, sourceOrigin(c));
    return c.json({ items, page });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
});

app.get('/api/media/:id', async (c) => {
  try {
    return c.json({ detail: await getDetail(c.req.param('id'), sourceOrigin(c)) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
});

function m3uValue(value: string): string {
  return value.replace(/["\r\n]/g, ' ').trim();
}

app.get('/api/playlist.m3u', async (c) => {
  try {
    const categoryIds = (c.req.query('categories') || c.req.query('category') || '10')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value))
      .slice(0, 4);
    const pageCount = Math.max(1, Math.min(3, Number(c.req.query('pages') || 1)));
    if (!categoryIds.length) return c.text('Invalid category', 400);

    const categoryNames = new Map((await getCategories(sourceOrigin(c))).map((entry) => [entry.id, entry.name]));
    const catalogRequests = categoryIds.flatMap((category) =>
      Array.from({ length: pageCount }, (_, index) =>
        getCatalog(category, index + 1, sourceOrigin(c)).then((items) => ({ category, items })),
      ),
    );
    const catalogs = await Promise.all(catalogRequests);
    const unique = new Map<string, { category: string; title: string; poster: string }>();
    for (const catalog of catalogs) {
      for (const item of catalog.items) {
        if (!unique.has(item.id)) unique.set(item.id, { category: catalog.category, title: item.title, poster: item.poster });
      }
    }

    const details = await Promise.allSettled(
      [...unique.entries()].map(async ([id, item]) => ({ item, detail: await getDetail(id, sourceOrigin(c)) })),
    );
    const base = publicOrigin(c);
    const lines = ['#EXTM3U'];
    for (const result of details) {
      if (result.status !== 'fulfilled') continue;
      const { item, detail } = result.value;
      const group = m3uValue(categoryNames.get(item.category) || detail.category || '小鸭看看');
      for (const episode of detail.episodes) {
        const episodeTitle = detail.episodes.length === 1 ? detail.title : `${detail.title} · ${episode.label}`;
        lines.push(
          `#EXTINF:-1 tvg-id="${m3uValue(`${detail.id}-${episode.index}`)}" tvg-name="${m3uValue(episodeTitle)}" tvg-logo="${m3uValue(detail.poster || item.poster)}" group-title="${group}",${m3uValue(episodeTitle)}`,
          `${base}/api/relay/${detail.id}/${episode.index}/stream.m3u8?source=0`,
        );
      }
    }
    return c.body(`${lines.join('\n')}\n`, 200, {
      'Content-Type': 'audio/x-mpegurl; charset=utf-8',
      'Content-Disposition': 'inline; filename="xiaoya.m3u"',
      'Cache-Control': 'public, max-age=300',
    });
  } catch (error) {
    return c.text(error instanceof Error ? error.message : String(error), 502);
  }
});

app.on(['GET', 'HEAD'], '/api/relay/:id/:episode/stream.m3u8', async (c) => {
  try {
    const id = c.req.param('id');
    const episode = Number(c.req.param('episode'));
    const sourceIndex = Number(c.req.query('source') || 0);
    const detail = await getDetail(id, sourceOrigin(c));
    const sources = detail.episodes[episode]?.sources;
    if (!sources?.length) return c.text('Episode not found', 404);
    if (c.req.method === 'HEAD') return c.body(null, 200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    const selectedIndex = Math.max(0, Math.min(sources.length - 1, sourceIndex));
    const candidates = [sources[selectedIndex], ...sources.filter((_source, index) => index !== selectedIndex)]
      .map((source) => source.url);
    const playable = await findPlayableHlsUrl(candidates);
    const proxyBase = `${publicOrigin(c)}/api/hls-proxy`;
    return serveProxiedHlsResource(playable, proxyBase, c.req.method, c.req.header('range'), true);
  } catch (error) {
    return c.text(error instanceof Error ? error.message : String(error), 502);
  }
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
