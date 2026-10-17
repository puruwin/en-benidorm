process.env.NODE_ENV = 'production'
process.env.CONTENT_LAB_MODE = 'private'
await import('./server')
export {}
