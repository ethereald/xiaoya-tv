import { handle } from '@hono/node-server/vercel';

import { app } from '../src/server/app.js';

export default handle(app);
