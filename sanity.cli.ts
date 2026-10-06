import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {
    projectId: process.env.SANITY_STUDIO_PROJECT_ID || 'demo',
    dataset: process.env.SANITY_STUDIO_DATASET || 'production',
  },
  typegen: {
    path: './src/**/*.{ts,astro}',
    schema: './schema.json',
    generates: './src/types/sanity.generated.ts',
    overloadClientMethods: true,
  },
})
