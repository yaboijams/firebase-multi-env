import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server.ts',
    'functions-v1': 'src/functions-v1.ts',
    'functions-v2': 'src/functions-v2.ts',
    client: 'src/client.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: [
    'firebase',
    'firebase/functions',
    'firebase-admin',
    'firebase-admin/app',
    'firebase-admin/auth',
    'firebase-admin/firestore',
    'firebase-functions',
    'firebase-functions/v1/https',
    'firebase-functions/v2/https',
  ],
});
