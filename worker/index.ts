/**
 * FF Content Writer — Anthropic API proxy.
 *
 * Lives on Cloudflare Workers (free tier: 100k req/day, no card required).
 * The real Anthropic API key is stored as a Worker Secret and never reaches
 * the browser. The static site at thebrimay-wq.github.io/ff-content-writer
 * calls this Worker instead of api.anthropic.com.
 *
 * Setup (one time):
 *   1. Sign up at cloudflare.com (free)
 *   2. From this folder:
 *        npx wrangler login
 *        npx wrangler secret put ANTHROPIC_API_KEY   # paste FF's key
 *        npx wrangler deploy
 *   3. Copy the printed URL (e.g. https://ff-claude-proxy.<acct>.workers.dev)
 *      and paste it into PROXY_URL in src/lib/api.ts.
 */

export interface Env {
  ANTHROPIC_API_KEY: string
  /** Comma-separated list of allowed Origin headers. Set in wrangler.toml. */
  ALLOWED_ORIGINS: string
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, anthropic-version',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function pickAllowedOrigin(origin: string, allowed: string): string | null {
  if (!origin) return null
  const list = allowed.split(',').map((s) => s.trim()).filter(Boolean)
  if (list.includes('*')) return origin
  return list.includes(origin) ? origin : null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? ''
    const allowed = pickAllowedOrigin(origin, env.ALLOWED_ORIGINS ?? '')

    // CORS preflight
    if (request.method === 'OPTIONS') {
      if (!allowed) return new Response(null, { status: 403 })
      return new Response(null, { status: 204, headers: corsHeaders(allowed) })
    }

    if (!allowed) {
      return new Response('Forbidden', { status: 403 })
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: corsHeaders(allowed),
      })
    }

    const url = new URL(request.url)
    if (url.pathname !== '/v1/messages') {
      return new Response('Not found', { status: 404, headers: corsHeaders(allowed) })
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response('Server misconfigured: missing ANTHROPIC_API_KEY secret', {
        status: 500,
        headers: corsHeaders(allowed),
      })
    }

    // Forward the body verbatim to Anthropic. We stream the response back
    // unchanged so the client's existing SSE parsing keeps working.
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: request.body,
    })

    const headers = new Headers(corsHeaders(allowed))
    const ct = upstream.headers.get('Content-Type')
    if (ct) headers.set('Content-Type', ct)

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    })
  },
}
