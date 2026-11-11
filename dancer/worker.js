// Cloud Dancer's connector, at https://dancer.unremarkable.me/mcp
//
// Cloud Dancer is Unremarkable's publishing agent. A site's owner changes their site by telling their
// own agent what they want; the agent passes it on through this connector. Who the owner is comes from
// the connector, not from the site: no site sets a cookie or asks anyone to log in, and no page carries
// a "change this" link.
//
//   /mcp            the connector (Model Context Protocol), for signed-in owners only: mcp.js
//   /authorize      the one page an owner meets, once, to sign in with a code sent to their email: signin.js
//   /oauth/...      tokens and registration, answered by Cloudflare's OAuth library
//   /agent/...      Cloud Dancer's own run, taking work and handing it in, with DANCER_SECRET: agent.js
//   /               a plain page saying what this is
//
// Nothing here changes a site. A request goes into Cloud Dancer's in-tray (the database); a change is made on
// a private preview copy; and only the owner's own "publish" puts it live.

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { mcp } from './mcp.js';
import { authorize, SCOPE } from './signin.js';
import { agentApi } from './agent.js';

const HOME = `Cloud Dancer, the publishing agent at Unremarkable.

This is the connector a site's owner adds to their own agent, so they can change their site by saying what they want.
Add https://dancer.unremarkable.me/mcp to your agent as a connector (a remote MCP server). You sign in once, with a code sent to the email address your site is registered to.

Only a site's owner can use it. Unremarkable: https://unremarkable.me/
`;

const api = {
  fetch(request, env, ctx) {
    const owner = ctx.props && ctx.props.email;
    if (!owner || !ctx.auth || !ctx.auth.scope.includes(SCOPE)) return new Response('Not signed in as an owner.', { status: 403 });
    return mcp(request, env, owner);
  },
};

const site = {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/authorize') return authorize(request, env);
    if (pathname.startsWith('/agent/')) return agentApi(request, env);
    if (pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
      return new Response(HOME, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' } });
    }
    return new Response('Not found', { status: 404 });
  },
};

// The address is a setting (DANCER_ORIGIN in wrangler.jsonc) so the same code runs on a laptop for testing.
const providers = new Map();
function provider(env) {
  const origin = env.DANCER_ORIGIN || 'https://dancer.unremarkable.me';
  if (!providers.has(origin)) {
    providers.set(origin, new OAuthProvider({
      apiRoute: '/mcp',
      apiHandler: api,
      defaultHandler: site,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: [SCOPE],
      requiredScopes: [SCOPE],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: 'Cloud Dancer' },
      clientIdMetadataDocumentEnabled: true,
      // A grant lasts while it is used: 90 days after the agent last used it, the owner signs in again.
      refreshTokenIdleTTL: 90 * 86400,
    }));
  }
  return providers.get(origin);
}

export default {
  fetch(request, env, ctx) {
    return provider(env).fetch(request, env, ctx);
  },
};
