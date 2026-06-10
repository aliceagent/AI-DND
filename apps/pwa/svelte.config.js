import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** SPA build: the orchestrator serves dist/ over mkcert HTTPS; index.html
 *  is the fallback for client-side routes. */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: "dist", assets: "dist", fallback: "index.html" }),
  },
};
