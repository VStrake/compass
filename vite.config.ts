import { defineConfig, type ViteDevServer } from 'vite';

/**
 * Local dev plugin that emulates Vercel Edge Functions.
 *
 * For each request to `/api/<name>`, we dynamically import `api/<name>.ts`
 * and call its default export with a Request object. This lets `vite dev`
 * serve the same handlers Vercel will run in production, including the
 * Anthropic API key from `.env.local`.
 */
function viteEdgeApiPlugin() {
  return {
    name: 'compass-edge-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api', async (req, res, next) => {
        if (!req.url) return next();
        const path = req.url.split('?')[0].replace(/^\//, '').replace(/\.[a-z]+$/i, '');
        if (!path) return next();

        try {
          const mod = await server.ssrLoadModule(`/api/${path}.ts`);
          const handler = mod.default as (r: Request) => Promise<Response> | Response;
          if (typeof handler !== 'function') {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'no_handler' }));
            return;
          }

          // Reconstruct a Web Request from the Node request.
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => resolve());
            req.on('error', reject);
          });
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (Array.isArray(v)) headers.set(k, v.join(','));
            else if (typeof v === 'string') headers.set(k, v);
          }
          const url = new URL(req.url || '/', 'http://localhost');
          const request = new Request(`http://localhost/api/${path}${url.search}`, {
            method: req.method,
            headers,
            body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined
          });

          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          const buf = Buffer.from(await response.arrayBuffer());
          res.end(buf);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: 'dev_api_error',
            detail: err instanceof Error ? err.message : String(err)
          }));
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [viteEdgeApiPlugin()],
  server: {
    port: 5174,
    host: true
  },
  build: {
    target: 'es2020',
    sourcemap: false
  }
});
