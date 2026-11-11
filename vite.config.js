import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest: o service worker é o nosso (src/sw.js, com o notificationclick do
      // Pomodoro) e o plugin injeta a lista de arquivos do build (self.__WB_MANIFEST).
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      registerType: "autoUpdate",
      injectManifest: {
        // Tudo o que o build gera e precisa abrir offline
        globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2,json}"],
        globIgnores: ["**/node_modules/**/*", "sw.js", "workbox-*.js"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // O service worker é registrado como script clássico: gera um único arquivo
        rollupFormat: "iife",
      },
      // O manifest.json já existe em public/ e continua como está
      manifest: false,
      // O registro é feito no index.html
      injectRegister: false,
      devOptions: { enabled: false },
    }),
  ],
});
