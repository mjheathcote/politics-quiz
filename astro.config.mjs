import { defineConfig } from "astro/config";

// Static output, deployed to Cloudflare Workers (static assets) behind
// politics.ryetown.uk — see wrangler.jsonc and README's "Hosting" section.
export default defineConfig({
  site: "https://politics.ryetown.uk",
  output: "static",
});
