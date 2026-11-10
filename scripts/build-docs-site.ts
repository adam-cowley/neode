/**
 * Build the static docs site from the markdown that already exists in the repo
 * (NTS-603). Every page is emitted twice — HTML for humans, markdown for agents —
 * plus llms.txt (index) and llms-full.txt (all pages concatenated) at the root,
 * per the llms.txt convention.
 *
 * Run with `pnpm docs:site`. Output goes to docs-site/ (gitignored).
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { marked } from 'marked'
import { gfmHeadingId } from 'marked-gfm-heading-id'

type Page = {
  /** Repo-relative markdown source */
  src: string
  /** Site-relative HTML output */
  out: string
  title: string
  group: string
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(REPO_ROOT, 'docs-site')

const AGENT_PAGES = [
  'core',
  'model-definition',
  'querying',
  'schema-management',
  'schema-reference',
  'testing-ops',
  'errors',
  'agent-ontology-api',
] as const

const PAGES: Page[] = [
  { src: 'README.md', out: 'index.html', title: 'Introduction', group: 'Guide' },
  { src: 'MIGRATION.md', out: 'migration.html', title: 'Migrating to 1.0', group: 'Guide' },
  {
    src: 'docs/migration-guide.md',
    out: 'docs/migration-guide.html',
    title: 'Migration guide (0.x → 1.0)',
    group: 'Guide',
  },
  { src: 'docs/RELEASE.md', out: 'docs/RELEASE.html', title: 'Release process', group: 'Guide' },
  {
    src: 'docs/api-reference.md',
    out: 'docs/api-reference.html',
    title: 'API reference',
    group: 'Reference',
  },
  ...AGENT_PAGES.map((name) => ({
    src: `docs/agent/${name}.md`,
    out: `docs/agent/${name}.html`,
    title:
      name === 'testing-ops'
        ? 'Testing & ops'
        : name === 'agent-ontology-api'
          ? 'Agent ontology API'
          : name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    group: 'Agent guide',
  })),
  {
    src: 'docs/decisions/0001-decorators.md',
    out: 'docs/decisions/0001-decorators.html',
    title: 'ADR 0001 — Standard decorators',
    group: 'Decisions',
  },
]

/** src ('docs/api-reference.md') -> out ('docs/api-reference.html'), README -> index */
const HTML_BY_SRC = new Map(PAGES.map((p) => [p.src, p.out]))
const MD_BY_SRC = new Map(PAGES.map((p) => [p.src, p.out.replace(/\.html$/, '.md')]))

/**
 * Parse a cookbook script's leading JSDoc block into a recipe page: the first
 * line is the title (with the `Cookbook — ` prefix dropped), the rest is the
 * prose body.
 */
export function extractRecipe(source: string): { title: string; body: string } {
  const header = /^\/\*\*([\s\S]*?)\*\//.exec(source)?.[1] ?? ''
  const lines = header
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .filter((line, index) => index > 0 || line.trim() !== '')
  const [titleLine = '', ...bodyLines] = lines
  return {
    title: titleLine
      .replace(/^Cookbook\s*[—-]\s*/, '')
      .replace(/\.$/, '')
      .trim(),
    body: bodyLines.join('\n').trim(),
  }
}

/**
 * Rewrite relative .md links to site paths (GitHub-style anchors are kept, and
 * heading ids are GitHub slugs via marked-gfm-heading-id, so they line up).
 * Links that resolve to a page get root-absolute hrefs; unknown targets are
 * left untouched.
 */
export function rewriteLinks(markdown: string, src: string, targets: Map<string, string>): string {
  const srcDir = path.posix.dirname(src)
  return markdown.replace(
    /\]\(([^)\s]+?)(#[^)\s]*)?\)/g,
    (whole, href: string, anchor?: string) => {
      if (!href.endsWith('.md')) return whole
      const resolved = path.posix.normalize(path.posix.join(srcDir === '.' ? '' : srcDir, href))
      const target = targets.get(resolved)
      if (!target) return whole
      return `](${['/' + target, anchor].filter(Boolean).join('')})`
    },
  )
}

const CSS = `
:root { color-scheme: light dark; --border: #e2e2e2; --muted: #667; --code-bg: #f6f8fa; }
@media (prefers-color-scheme: dark) {
  :root { --border: #30363d; --muted: #9aa0a6; --code-bg: #161b22; }
}
* { box-sizing: border-box; }
body { margin: 0; display: flex; font: 16px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
nav { width: 260px; flex-shrink: 0; padding: 24px 16px 48px; border-right: 1px solid var(--border); height: 100vh; overflow-y: auto; }
nav h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 20px 0 6px; }
nav a { display: block; padding: 3px 8px; border-radius: 6px; color: inherit; text-decoration: none; font-size: 14px; }
nav a:hover { background: var(--code-bg); }
nav a.active { background: var(--code-bg); font-weight: 600; }
main { padding: 32px 48px 80px; max-width: 60rem; min-width: 0; }
pre, code, kbd { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
pre { background: var(--code-bg); padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 14px; }
code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; font-size: .9em; }
pre code { padding: 0; background: none; }
blockquote { border-left: 3px solid var(--border); margin-left: 0; padding: 0 1em; color: var(--muted); }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--border); padding: 6px 12px; text-align: left; }
img { max-width: 100%; }
header.site { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
header.site a { font-weight: 700; text-decoration: none; color: inherit; font-size: 18px; }
header.site span { color: var(--muted); font-size: 13px; }
footer.site { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
`

function layout(
  pages: Page[],
  content: string,
  active: string,
  version: string,
  description: string,
): string {
  const groups = [...new Set(pages.map((p) => p.group))]
  const nav = groups
    .map((group) => {
      const links = pages
        .filter((p) => p.group === group)
        .map(
          (p) => `<a href="/${p.out}"${p.out === active ? ' class="active"' : ''}>${p.title}</a>`,
        )
        .join('')
      return `<h2>${group}</h2>${links}`
    })
    .join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${description}">
<title>${active === 'index.html' ? 'neode' : `${pages.find((p) => p.out === active)?.title} — neode`}</title>
<style>${CSS}</style>
</head>
<body>
<nav><header class="site"><a href="/">neode</a><span>v${version}</span></header>${nav}</nav>
<main>
${content}
<footer class="site"><a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a> — this site is agent-ready: every page also ships as markdown.</footer>
</main>
</body>
</html>
`
}

async function build(): Promise<void> {
  const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    version: string
    description: string
  }
  marked.use(gfmHeadingId())

  await rm(OUT_DIR, { recursive: true, force: true })

  // Cookbook pages are generated from the example scripts (examples/cookbook):
  // JSDoc header as prose, full source in a fenced block. One page per recipe,
  // in the teaching order examples/README.md gives (unlisted files go last).
  const order = [
    'crud-collection',
    'relationships',
    'eager-read-models',
    'validation',
    'schema-sync',
    'search-fulltext-vector',
    'batch-and-transactions',
    'multi-database',
    'server-startup',
  ]
  const cookbook = await Promise.all(
    (await readdir(path.join(REPO_ROOT, 'examples/cookbook')))
      .filter((file) => file.endsWith('.ts'))
      .map(async (file) => {
        const source = await readFile(path.join(REPO_ROOT, 'examples/cookbook', file), 'utf8')
        const { title, body } = extractRecipe(source)
        // 4-backtick fence: the sources contain template literals
        const markdown = `# ${title}\n\n${body}\n\n## Source\n\n\`\`\`\`ts\n${source}\`\`\`\`\n`
        return {
          page: {
            src: `examples/cookbook/${file}`,
            out: `cookbook/${file.replace(/\.ts$/, '.html')}`,
            title,
            group: 'Cookbook',
          } satisfies Page,
          markdown,
        }
      }),
  )
  const rank = (src: string): number => {
    const index = order.indexOf(path.basename(src, '.ts'))
    return index === -1 ? Number.POSITIVE_INFINITY : index
  }
  cookbook.sort((a, b) => rank(a.page.src) - rank(b.page.src))

  const markdowns = await Promise.all([
    ...PAGES.map(async (page) => ({
      page,
      markdown: await readFile(path.join(REPO_ROOT, page.src), 'utf8'),
    })),
    ...cookbook,
  ])
  const pages = markdowns.map(({ page }) => page)

  for (const { page, markdown } of markdowns) {
    const htmlMd = rewriteLinks(markdown, page.src, HTML_BY_SRC)
    const agentMd = rewriteLinks(markdown, page.src, MD_BY_SRC)
    const html = layout(pages, await marked.parse(htmlMd), page.out, pkg.version, pkg.description)

    for (const [file, body] of [
      [page.out, html],
      [page.out.replace(/\.html$/, '.md'), agentMd],
    ] as const) {
      const target = path.join(OUT_DIR, file)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, body)
    }
  }

  const mdPath = (p: Page) => `/${p.out.replace(/\.html$/, '.md')}`
  const index = [
    `# neode docs\n\n> ${pkg.description} (v${pkg.version})\n`,
    ...[...new Set(pages.map((p) => p.group))].map((group) => {
      const lines = pages
        .filter((p) => p.group === group)
        .map((p) => `- [${p.title}](${mdPath(p)})`)
      return `## ${group}\n\n${lines.join('\n')}`
    }),
  ].join('\n\n')

  const full = markdowns
    .map(
      ({ page, markdown }) => `# ${page.title}\n\n${rewriteLinks(markdown, page.src, MD_BY_SRC)}`,
    )
    .join('\n\n---\n\n')

  await writeFile(path.join(OUT_DIR, 'llms.txt'), `${index}\n`)
  await writeFile(path.join(OUT_DIR, 'llms-full.txt'), `${full}\n`)

  console.log(`docs-site: ${markdowns.length} pages (HTML + markdown), llms.txt, llms-full.txt`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  build().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
