/// <reference types="astro/client" />
/// <reference types="@sanity/astro/module" />

interface ImportMetaEnv {
  readonly CONTENT_SOURCE?: 'demo' | 'sanity'
  readonly PUBLIC_SITE_URL?: string
  readonly PUBLIC_SANITY_PROJECT_ID?: string
  readonly PUBLIC_SANITY_DATASET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
