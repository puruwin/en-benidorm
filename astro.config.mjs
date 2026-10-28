import sitemap from '@astrojs/sitemap'
import sanity from '@sanity/astro'
import tailwindcss from '@tailwindcss/vite'
import {defineConfig} from 'astro/config'
import {fileURLToPath} from 'node:url'
import {loadEnv} from 'vite'
import {sitemapIncludes} from './scripts/seo/lib/page-type.ts'

const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '')
const dist = fileURLToPath(new URL('./dist/', import.meta.url))

export default defineConfig({
  site: env.PUBLIC_SITE_URL || 'https://enbenidorm.es',
  output: 'static',
  integrations: [
    sanity({
      projectId: env.PUBLIC_SANITY_PROJECT_ID || 'demo',
      dataset: env.PUBLIC_SANITY_DATASET || 'production',
      apiVersion: '2026-10-06',
      useCdn: false,
    }),
    // Solo las páginas que SeoHead dejó con robots index (lee dist; la regla está en src/lib/indexability.ts).
    sitemap({filter: (url) => sitemapIncludes(url, dist)}),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    domains: ['cdn.sanity.io'],
    responsiveStyles: true,
  },
})
