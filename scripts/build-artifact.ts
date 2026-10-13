/**
 * Builds the Claude Artifact from the same components as the Next.js app.
 *
 *   npm run build:artifact [-- --snapshot <file> --out <dir>]   -> dist/artifact/signal-ai.html + snapshot.json
 *
 * The page loads React 18 from cdnjs (the Artifact CSP allows it), inlines the
 * compiled Tailwind CSS and the app bundle, and reads `snapshot.json`, which
 * is published next to it. Run `npm run export:snapshot` first, or pass
 * `--snapshot <path>`.
 */
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const out = path.resolve(root, arg('--out') ?? 'dist/artifact');

async function main() {
  await mkdir(out, { recursive: true });
  const snapshotSource = path.resolve(arg('--snapshot') ?? 'public/data/snapshot.json');
  await stat(snapshotSource).catch(() => {
    throw new Error(`No snapshot at ${snapshotSource}. Run "npm run export:snapshot" first.`);
  });

  // Tailwind resolves its own package relative to the input file, so that file must live inside the project
  // even when the output directory does not.
  const work = path.join(root, 'dist/.build');
  await mkdir(work, { recursive: true });
  const cssInput = path.join(work, 'input.css');
  const globals = await readFile(path.join(root, 'app/globals.css'), 'utf8');
  // Tell Tailwind exactly which files can contain class names for this build.
  await writeFile(cssInput, globals.replace("@import 'tailwindcss';", `@import 'tailwindcss' source(none);\n@source '${path.join(root, 'components')}';\n@source '${path.join(root, 'artifact')}';`));
  const cssOutput = path.join(work, 'app.css');
  execFileSync(path.join(root, 'node_modules/.bin/tailwindcss'), ['-i', cssInput, '-o', cssOutput, '--minify'], { stdio: 'pipe' });
  const css = await readFile(cssOutput, 'utf8');

  const result = await build({
    entryPoints: [path.join(root, 'artifact/main.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    minify: true,
    jsx: 'transform',
    // Classic JSX against the global React; the project tsconfig asks for the automatic runtime.
    tsconfigRaw: { compilerOptions: { jsx: 'react' } },
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    inject: [path.join(root, 'artifact/shims/inject.js')],
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_SITE_URL': 'undefined' },
    alias: {
      react: path.join(root, 'artifact/shims/react.cjs'),
      'next/link': path.join(root, 'artifact/shims/next-link.tsx'),
      '@/lib/client/platform': path.join(root, 'artifact/platform.tsx'),
      '@': root,
    },
    logLevel: 'warning',
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

  const html = `<title>SIGNAL / AI</title>
<style>${css}</style>
<div id="signal-root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${js}</script>
`;
  await writeFile(path.join(out, 'signal-ai.html'), html);

  // --site <dir>: the same page as a complete document for static hosting (GitHub Pages).
  const site = arg('--site');
  if (site) {
    const dir = path.resolve(root, site);
    await mkdir(dir, { recursive: true });
    const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="What people are building, releasing and testing across AI and emerging technology, with the evidence behind each item.">
</head>
<body>
<script>window.__SIGNAL_SITE__ = true;</script>
${html}</body>
</html>
`;
    await writeFile(path.join(dir, 'index.html'), page);
    await copyFile(snapshotSource, path.join(dir, 'snapshot.json'));
    await writeFile(path.join(dir, '.nojekyll'), '');
    console.log(`Built static site in ${path.relative(root, dir)}/`);
  }
  await copyFile(snapshotSource, path.join(out, 'snapshot.json'));
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  console.log(`Built ${path.relative(root, out)}/signal-ai.html (${kb(html.length)}: css ${kb(css.length)}, js ${kb(js.length)}) and snapshot.json (${kb((await stat(snapshotSource)).size)})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
