import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  PRIVATE_PAGE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, findDiscoveryPage, pageTitle, structuredData,
} from '../../../../shared/site-discovery'

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.append(element)
  }
  element.content = content
}

export default function SiteMetadata({ docs = false }: { docs?: boolean }) {
  const { pathname } = useLocation()
  useEffect(() => {
    const path = docs ? `/docs${pathname === '/' ? '/overview' : pathname}` : pathname
    const page = findDiscoveryPage(path)
    const title = page ? pageTitle(page) : SITE_NAME
    const description = page?.description ?? PRIVATE_PAGE_DESCRIPTION
    document.title = title
    setMeta('name', 'description', description)
    setMeta('name', 'robots', page ? 'index, follow' : 'noindex, follow')
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    setMeta('name', 'twitter:title', title)
    setMeta('name', 'twitter:description', description)
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    const schema = document.getElementById('site-structured-data')
    if (page) {
      if (!canonical) {
        canonical = document.createElement('link')
        canonical.rel = 'canonical'
        document.head.append(canonical)
      }
      canonical.href = `${SITE_ORIGIN}${page.path}`
      setMeta('property', 'og:url', canonical.href)
      const element = schema ?? document.createElement('script')
      element.id = 'site-structured-data'
      element.setAttribute('type', 'application/ld+json')
      element.textContent = structuredData(page)
      if (!schema) document.head.append(element)
    } else {
      canonical?.remove()
      schema?.remove()
      document.head.querySelector('meta[property="og:url"]')?.remove()
    }
  }, [pathname, docs])
  return null
}
