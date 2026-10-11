import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// In development the /api functions (api/*.js) run inside the Vite server,
// with the variables from .env, so `npm run dev` is all you need.
// On Vercel they run as serverless functions.
function apiFunctions() {
  return {
    name: "api-functions",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/(arcade|videoselz)(\?|$)/);
        if (!match) return next();
        const mod = await server.ssrLoadModule(`/api/${match[1]}.js`);
        return mod.default(req, res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Server-only variables (no VITE_ prefix): never sent to the browser.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return { plugins: [react(), apiFunctions()] };
});
