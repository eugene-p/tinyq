import { defineConfig } from 'tsup'

// Root + area barrels → `@qkitt/tinyq` and `@qkitt/tinyq/<area>`.
// Declarations still come from `tsc -p tsconfig.build.json` (tsup dts is
// incompatible with TypeScript 7's compiler host APIs today).
export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'events/index': 'src/events/index.ts',
        'queue/index': 'src/queue/index.ts',
        'worker/index': 'src/worker/index.ts',
    },
    format: ['esm'],
    dts: false,
    sourcemap: false,
    minify: true,
    clean: true,
    target: 'es2022',
    outDir: 'dist',
    treeshake: true,
    // Shared modules across root + subpath entries (avoid full duplication).
    splitting: true,
})
