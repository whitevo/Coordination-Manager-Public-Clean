import type { Plugin } from 'vite'
import {
  DOCS_PAGES, WEB_PAGES, discoveryBody, discoveryHead, findDiscoveryPage,
  llmsTxt, normalizeDiscoveryPath, robotsTxt, sitemapXml,
} from '../../../shared/site-discovery.ts'
import type { DiscoveryPage } from '../../../shared/site-discovery.ts'

export function renderDiscoveryHtml(html: string, page?: DiscoveryPage): string {
  if (!html.includes('<!-- discovery-head:start -->') || !html.includes('<!-- discovery-body:start -->')) {
    throw new Error('Discovery HTML template markers are missing')
  }
  return html
    .replace(/<!-- discovery-head:start -->[\s\S]*?<!-- discovery-head:end -->/, `<!-- discovery-head:start -->\n${discoveryHead(page)}\n<!-- discovery-head:end -->`)
    .replace(/<!-- discovery-body:start -->[\s\S]*?<!-- discovery-body:end -->/, `<!-- discovery-body:start -->\n${discoveryBody(page ?? WEB_PAGES[0])}\n<!-- discovery-body:end -->`)
}

export function discoveryPreviewPath(app: 'web' | 'docs', url: string): string {
  const [pathname, query] = url.split('?')
  if (pathname.includes('.') || pathname.startsWith('/assets/') || pathname.startsWith('/docs/assets/')) return url
  const page = findDiscoveryPage(normalizeDiscoveryPath(pathname) === '/docs' ? '/docs/overview' : pathname)
  const destination = page
    ? page.path === '/' ? '/index.html' : `${page.path}/index.html`
    : app === 'docs' || pathname.startsWith('/docs/') ? '/docs/app-shell.html' : '/app-shell.html'
  return `${destination}${query === undefined ? '' : `?${query}`}`
}

export function discoveryPlugin(app: 'web' | 'docs'): Plugin {
  const pages = app === 'web' ? WEB_PAGES : DOCS_PAGES
  const defaultPage = pages[0]
  const resources = {
    '/robots.txt': { type: 'text/plain; charset=utf-8', content: robotsTxt() },
    '/sitemap.xml': { type: 'application/xml; charset=utf-8', content: sitemapXml() },
    '/llms.txt': { type: 'text/plain; charset=utf-8', content: llmsTxt() },
  }
  return {
    name: 'public-site-discovery',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const pathname = (context.originalUrl ?? context.path).split('?')[0]
        const page = pathname === '/index.html' || (app === 'docs' && pathname === '/docs/index.html')
          ? defaultPage
          : findDiscoveryPage(pathname)
        return renderDiscoveryHtml(html, page)
      },
    },
    configureServer(server) {
      if (app !== 'web') return
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0]
        const resource = Object.entries(resources).find(([route]) => route === pathname)?.[1]
        if (!resource) return next()
        response.setHeader('Content-Type', resource.type)
        response.end(resource.content)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url) request.url = discoveryPreviewPath(app, request.url)
        next()
      })
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const index = bundle['index.html']
        if (!index || index.type !== 'asset' || typeof index.source !== 'string') {
          throw new Error('Discovery generation requires the built index.html asset')
        }
        index.source = renderDiscoveryHtml(index.source, defaultPage)
        this.emitFile({ type: 'asset', fileName: 'app-shell.html', source: renderDiscoveryHtml(index.source) })
        for (const page of pages) {
          if (app === 'web' && page.path === '/') continue
          const relativePath = app === 'docs' ? page.path.slice('/docs/'.length) : page.path.slice(1)
          this.emitFile({
            type: 'asset',
            fileName: `${relativePath}/index.html`,
            source: renderDiscoveryHtml(index.source, page),
          })
        }
        if (app === 'web') {
          for (const [route, resource] of Object.entries(resources)) {
            this.emitFile({ type: 'asset', fileName: route.slice(1), source: resource.content })
          }
        }
      },
    },
  }
}
