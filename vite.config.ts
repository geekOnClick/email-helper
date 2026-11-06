/**
 * Конфигурация Vite для сборки веб-SPA (transport/web).
 *
 * Корень сборки — `src/transport/web/client/` (HTML+TSX-исходники).
 * Сборка пишется в `dist/client/` (отдаётся Node HTTP-сервером на корневом
 * маршруте). Dev-сервер Vite (порт 5173) проксирует `/api` на бэкенд
 * (`WEB_PORT`, по умолчанию 3000) — CORS на API разрешает dev-origin.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { config as loadEnv } from 'dotenv';

// Загружаем .env, чтобы dev-прокси Vite бил на тот же порт, что и бэкенд
// (`WEB_PORT`, по умолчанию 3000). Vite сам читает .env только для import.meta.env,
// а process.env.WEB_PORT здесь нужен для target прокси.
loadEnv();
const API_PORT = process.env.WEB_PORT ?? '3000';

export default defineConfig({
  root: 'src/transport/web/client',
  plugins: [react()],
  build: {
    outDir: '../../../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
