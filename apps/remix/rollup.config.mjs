import linguiMacro from '@lingui/babel-plugin-lingui-macro';
import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import path from 'node:path';

/**
 * Rollup plugin that replaces `import.meta.glob(...)` calls with `{}`.
 * `import.meta.glob` is a Vite-only transform; in the rollup server bundle it would
 * crash at runtime because `import.meta.glob` is undefined in Node.
 * Replacing with `{}` lets the filesystem-import fallback in i18n.ts take over.
 *
 * @type {import('rollup').Plugin}
 */
const stubImportMetaGlob = {
  name: 'stub-import-meta-glob',
  transform(code) {
    if (!code.includes('import.meta.glob')) return null;
    // Matches: import.meta.glob<GenericType>('pattern') or import.meta.glob('pattern')
    const result = code.replace(
      /import\.meta\.glob(?:<[^>]*>)?\s*\(\s*['"\`][^'"\`]+['"\`]\s*,?\s*\)/gs,
      '{}',
    );
    return result !== code ? { code: result, map: null } : null;
  },
};

/** @type {import('rollup').RollupOptions} */
const config = {
  /**
   * We specifically target the router.ts instead of the entry point so the rollup doesn't go through the
   * already prebuilt RR7 server files.
   */
  input: 'server/router.ts',
  output: {
    dir: 'build/server/hono',
    format: 'esm',
    sourcemap: true,
    preserveModules: true,
    preserveModulesRoot: '.',
  },
  external: [
    (id) => {
      // Bundle @noble packages to avoid version mismatches at runtime.
      if (/@noble\//.test(id)) {
        return false;
      }

      return /node_modules/.test(id);
    },
  ],
  plugins: [
    stubImportMetaGlob,
    typescript({
      noEmitOnError: true,
      moduleResolution: 'bundler',
      include: ['server/**/*', '../../packages/**/*', '../../packages/lib/translations/**/*'],
      jsx: 'preserve',
    }),
    resolve({
      rootDir: path.join(process.cwd(), '../..'),
      preferBuiltins: true,
      resolveOnly: [
        '@documenso/api/*',
        '@documenso/auth/*',
        '@documenso/lib/*',
        '@documenso/trpc/*',
        '@documenso/email/*',
        '@noble/*',
      ],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    }),
    json(),
    commonjs(),
    babel({
      babelHelpers: 'bundled',
      extensions: ['.ts', '.tsx'],
      presets: ['@babel/preset-typescript', ['@babel/preset-react', { runtime: 'automatic' }]],
      plugins: [linguiMacro],
    }),
  ],
};

export default config;
