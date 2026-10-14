import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /**
   * Превью-прокси шлёт запросы к /_next/* с домена *.space-z.ai —
   * без этого списка Next.js 16 помечает их как cross-origin и
   * загрузка dev-чанков в браузере падает («Failed to load chunk
   * …react-server-dom-turbopack…»). Разрешаем превью-домен.
   */
  allowedDevOrigins: ["*.space-z.ai", "localhost", "127.0.0.1"],
};

export default nextConfig;
