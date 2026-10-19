import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:pages`：打包成 GitHub Pages 用的 docs/，CSS 與 JavaScript 全部內嵌進單一 index.html；
// 地圖資料（public/data）照原樣複製到 docs/data，用相對路徑讀取，所以放在任何子路徑都能開
export default defineConfig(({ mode }) =>
  mode === 'pages'
    ? {
        base: './',
        plugins: [viteSingleFile()],
        build: { outDir: 'docs', emptyOutDir: true, chunkSizeWarningLimit: 4096 },
      }
    : {},
);
