import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server/index.ts',
    'functions-v1': 'src/functions/v1.ts',
    'functions-v2': 'src/functions/v2.ts',
    http: 'src/http.ts',
    client: 'src/client/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: [
    'firebase',
    'firebase/app',
    'firebase/functions',
    'firebase/firestore',
    'firebase-admin',
    'firebase-admin/app',
    'firebase-admin/auth',
    'firebase-admin/firestore',
    'firebase-functions',
    'firebase-functions/v1/https',
    'firebase-functions/v2/https',
  ],
});
