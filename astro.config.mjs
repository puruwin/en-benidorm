import sitemap from '@astrojs/sitemap'
import sanity from '@sanity/astro'
import tailwindcss from '@tailwindcss/vite'
import {defineConfig} from 'astro/config'
import {loadEnv} from 'vite'

const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '')

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
    sitemap(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    domains: ['cdn.sanity.io'],
    responsiveStyles: true,
  },
})
