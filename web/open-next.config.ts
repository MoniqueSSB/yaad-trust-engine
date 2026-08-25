import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Adapts the Next.js build to run on Cloudflare Workers instead of Vercel.
 * Deliberate choice: Yaadly consolidates on Cloudflare, and this keeps real
 * server rendering, middleware and route handlers, all of which a static
 * export would have thrown away.
 */
export default defineCloudflareConfig();
