const STREAM_USER_AGENT =
  'Mozilla/5.0 (Android TV; XiaoyaTV/0.1) AppleWebKit/537.36 Chrome/124 Safari/537.36';

const STREAM_HEADERS = {
  accept: '*/*',
  referer: 'https://xiaoyakankan.com/',
  'user-agent': STREAM_USER_AGENT,
};

// WebDAV clients require a numeric Content-Length even for a live,
// non-seekable response. This upper bound keeps the HTTP bridge open while the
// HLS segments are joined; the connection still closes normally at end of file.
export const VIRTUAL_TS_FILE_LENGTH = 4_294_967_296;

function absoluteReference(reference: string, baseUrl: string): string {
  try {
    return new URL(reference, baseUrl).toString();
  } catch {
    return reference;
  }
}

export function rewriteHlsManifest(manifest: string, baseUrl: string): string {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (!line.startsWith('#')) return absoluteReference(line.trim(), baseUrl);
      return line.replace(/URI="([^"]+)"/g, (_match, uri: string) =>
        `URI="${absoluteReference(uri, baseUrl)}"`,
      );
    })
    .join('\n');
}

const allowedProxyHosts = new Set<string>();

function registerProxyTarget(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported HLS URL protocol');
  allowedProxyHosts.add(parsed.hostname.toLowerCase());
  return parsed.toString();
}

function proxiedReference(reference: string, upstreamBase: string, proxyBase: string): string {
  const absolute = registerProxyTarget(absoluteReference(reference, upstreamBase));
  return `${proxyBase}?url=${encodeURIComponent(absolute)}`;
}

function rewriteHlsManifestForProxy(manifest: string, upstreamBase: string, proxyBase: string): string {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (!line.startsWith('#')) return proxiedReference(line.trim(), upstreamBase, proxyBase);
      return line.replace(/URI="([^"]+)"/g, (_match, uri: string) =>
        `URI="${proxiedReference(uri, upstreamBase, proxyBase)}"`,
      );
    })
    .join('\n');
}

export async function serveProxiedHlsResource(
  url: string,
  proxyBase: string,
  method = 'GET',
  range?: string,
  trusted = false,
): Promise<Response> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) return new Response('Invalid stream URL', { status: 400 });
  if (!trusted && !allowedProxyHosts.has(parsed.hostname.toLowerCase())) {
    return new Response('Stream host is not registered', { status: 403 });
  }

  const requestHeaders: Record<string, string> = { ...STREAM_HEADERS };
  if (range) requestHeaders.range = range;
  const upstream = await fetch(parsed, {
    method,
    headers: requestHeaders,
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`Stream asset returned HTTP ${upstream.status}`, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || '';
  const isManifest = parsed.pathname.toLowerCase().endsWith('.m3u8') || /mpegurl/i.test(contentType);
  if (isManifest && method !== 'HEAD') {
    registerProxyTarget(upstream.url || parsed.toString());
    const manifest = rewriteHlsManifestForProxy(await upstream.text(), upstream.url || parsed.toString(), proxyBase);
    return new Response(`${manifest.trimEnd()}\n`, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const headers = new Headers({
    'Content-Type': contentType || 'application/octet-stream',
    'Cache-Control': upstream.headers.get('cache-control') || 'public, max-age=300',
    'Access-Control-Allow-Origin': '*',
  });
  for (const name of ['content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers });
}

export async function serveHlsManifest(url: string, method = 'GET'): Promise<Response> {
  const upstream = await fetch(url, {
    headers: STREAM_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  if (!upstream.ok) throw new Error(`Stream source returned HTTP ${upstream.status}`);

  const headers = {
    'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  };
  if (method === 'HEAD') return new Response(null, { status: 200, headers });

  const manifest = rewriteHlsManifest(await upstream.text(), upstream.url || url);
  if (!manifest.trimStart().startsWith('#EXTM3U')) throw new Error('Stream source did not return an HLS manifest');
  return new Response(`${manifest.trimEnd()}\n`, { status: 200, headers });
}

interface SegmentKey {
  method: string;
  url: string;
  iv?: Uint8Array;
}

interface HlsSegment {
  url: string;
  sequence: number;
  key?: SegmentKey;
}

function parseAttributeList(value: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of value.matchAll(/(?:^|,)([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi)) {
    attributes.set(match[1].toUpperCase(), match[2].replace(/^"|"$/g, ''));
  }
  return attributes;
}

function sequenceIv(sequence: number): Uint8Array {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, sequence);
  return iv;
}

function parseIv(value: string): Uint8Array {
  const hex = value.replace(/^0x/i, '').padStart(32, '0').slice(-32);
  return Uint8Array.from(hex.match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16));
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; finalUrl: string }> {
  const response = await fetch(url, {
    headers: STREAM_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Stream asset returned HTTP ${response.status}`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), finalUrl: response.url || url };
}

async function resolveMediaPlaylist(url: string, depth = 0): Promise<{ segments: HlsSegment[] }> {
  if (depth > 4) throw new Error('HLS master playlist nesting is too deep');
  const { bytes, finalUrl } = await fetchBytes(url);
  const text = new TextDecoder().decode(bytes);
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Stream source did not return an HLS playlist');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const variants: Array<{ bandwidth: number; url: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('#EXT-X-STREAM-INF:')) continue;
    const attributes = parseAttributeList(lines[index].slice(lines[index].indexOf(':') + 1));
    const next = lines.slice(index + 1).find((line) => !line.startsWith('#'));
    if (next) variants.push({
      bandwidth: Number(attributes.get('BANDWIDTH') || 0),
      url: absoluteReference(next, finalUrl),
    });
  }
  if (variants.length) {
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    return resolveMediaPlaylist(variants[0].url, depth + 1);
  }

  let sequence = Number(lines.find((line) => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'))?.split(':')[1] || 0);
  let key: SegmentKey | undefined;
  const segments: HlsSegment[] = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MAP:')) throw new Error('This source uses fragmented MP4 instead of MPEG-TS');
    if (line.startsWith('#EXT-X-KEY:')) {
      const attributes = parseAttributeList(line.slice(line.indexOf(':') + 1));
      const method = attributes.get('METHOD') || 'NONE';
      const keyUri = attributes.get('URI');
      key = method === 'NONE' || !keyUri ? undefined : {
        method,
        url: absoluteReference(keyUri, finalUrl),
        iv: attributes.get('IV') ? parseIv(attributes.get('IV')!) : undefined,
      };
      continue;
    }
    if (line.startsWith('#')) continue;
    segments.push({ url: absoluteReference(line, finalUrl), sequence, key });
    sequence += 1;
  }
  if (!segments.length) throw new Error('HLS media playlist contains no segments');
  return { segments };
}

async function loadTransportSegment(
  segment: HlsSegment,
  keyCache: Map<string, Promise<Uint8Array>>,
): Promise<Uint8Array> {
  let { bytes } = await fetchBytes(segment.url);
  if (!segment.key) return bytes;
  if (segment.key.method !== 'AES-128') throw new Error(`Unsupported HLS encryption: ${segment.key.method}`);
  let keyPromise = keyCache.get(segment.key.url);
  if (!keyPromise) {
    keyPromise = fetchBytes(segment.key.url).then((result) => result.bytes);
    keyCache.set(segment.key.url, keyPromise);
  }
  const rawKey = await keyPromise;
  // Vercel type-checks functions with both Node and DOM declarations. In that
  // environment a fetched Uint8Array may be backed by ArrayBufferLike, while
  // Web Crypto intentionally accepts only an ArrayBuffer-backed view. Copying
  // the values also makes that runtime guarantee explicit.
  const cryptoKey = await crypto.subtle.importKey('raw', Uint8Array.from(rawKey), 'AES-CBC', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: Uint8Array.from(segment.key.iv || sequenceIv(segment.sequence)) },
    cryptoKey,
    Uint8Array.from(bytes),
  );
  bytes = new Uint8Array(decrypted);
  return bytes;
}

export async function findPlayableHlsUrl(urls: string[]): Promise<string> {
  let lastError: unknown;
  for (const candidate of urls) {
    try {
      const { segments } = await resolveMediaPlaylist(candidate);
      const bytes = await loadTransportSegment(segments[0], new Map());
      if (bytes[0] !== 0x47) throw new Error('Source did not yield an MPEG-TS segment');
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No playable source is available');
}

export async function serveHlsAsTransportStream(urls: string | string[], method = 'GET'): Promise<Response> {
  const headers = {
    'Content-Type': 'video/mp2t',
    'Content-Length': String(VIRTUAL_TS_FILE_LENGTH),
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'none',
    'Access-Control-Allow-Origin': '*',
  };
  if (method === 'HEAD') return new Response(null, { status: 200, headers });

  const candidates = Array.isArray(urls) ? urls : [urls];
  let prepared: { segments: HlsSegment[]; firstBytes: Uint8Array; keyCache: Map<string, Promise<Uint8Array>> } | undefined;
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const { segments } = await resolveMediaPlaylist(candidate);
      const keyCache = new Map<string, Promise<Uint8Array>>();
      const firstBytes = await loadTransportSegment(segments[0], keyCache);
      if (firstBytes[0] !== 0x47) throw new Error('Source did not yield an MPEG-TS segment');
      prepared = { segments, firstBytes, keyCache };
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!prepared) throw lastError instanceof Error ? lastError : new Error('No playable source is available');

  const { segments, firstBytes, keyCache } = prepared;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= segments.length) {
        controller.close();
        return;
      }
      const segmentIndex = index++;
      try {
        const bytes = segmentIndex === 0
          ? firstBytes
          : await loadTransportSegment(segments[segmentIndex], keyCache);
        controller.enqueue(bytes);
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(body, { status: 200, headers });
}
