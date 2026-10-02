import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

import { app as api } from './app.js';

const app = new Hono();
app.route('/', api);
app.get('/xiaoya-tv.apk', async (c, next) => {
  c.header('Content-Disposition', 'attachment; filename="xiaoya-tv.apk"');
  await next();
}, serveStatic({ path: './xiaoya-tv.apk' }));
app.use('/*', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ path: './dist/index.html' }));

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Xiaoya TV listening on http://0.0.0.0:${info.port}`);
});
