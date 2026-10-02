import { useLocation, useRoutes } from 'react-router-dom'
import { ErrorBoundary } from 'react-error-boundary'
import { lazy, Suspense, useState } from 'react'
import RootLayout from '@/app/layout'
import Error from '@/app/error'
import NotFound from '@/app/not-found.jsx'

const pages = import.meta.glob('./app/**/page.jsx')
const layouts = import.meta.glob('./app/**/layout.jsx')
const DocumentPage = lazy(pages['./app/document/page.jsx'])

const Wrapper = ({ layouts, children }) => {
  if (layouts.length == 0) return children
  return layouts.reduce((acc, layout) => {
    const Layout = layout
    return <Layout>{acc}</Layout>
  }, children)
}

const routes = Object.entries(pages).map(([path, module]) => {
  const appliedLayouts = Object.entries(layouts)
    .filter(([layoutPath]) => {
      const normalizedPath = path.replace(/.*\/app/, '').replace('/page.jsx', '')
      const normalizedLayoutPath = layoutPath.replace(/.*\/app/, '').replace('/layout.jsx', '')

      return normalizedLayoutPath && normalizedPath.startsWith(normalizedLayoutPath)
    })
    .sort(([path_1], [path_2]) => path_1.length - path_2.length)
    .map(([, layout]) => lazy(layout))

  const route = path
    .replace(/.*\/app/, '')
    .replace('/page.jsx', '')
    .replace(/\[(.*?)\]/g, ':$1')
    .replace(/\/\((.*?)\)/g, '')

  const Page = lazy(module)

  return {
    path: route || '/',
    element: route === '/document' ? null : (
      <ErrorBoundary FallbackComponent={Error}>
        <Wrapper layouts={appliedLayouts}>
          <Page />
        </Wrapper>
      </ErrorBoundary>
    ),
  }
})

// Add 404 route
routes.push({
  path: '*',
  element: (
    <ErrorBoundary FallbackComponent={Error}>
      <NotFound />
    </ErrorBoundary>
  ),
})

export default function AppRouter() {
  const active = useLocation().pathname === '/document'
  const [documentVisited, setDocumentVisited] = useState(active)
  if (active && !documentVisited) setDocumentVisited(true)
  const route = useRoutes(routes)

  return (
    <RootLayout>
      {route}
      {documentVisited && (
        <div
          hidden={!active}
          className='min-h-0 flex-1 flex-col'
          style={{ display: active ? 'flex' : 'none' }}
        >
          <ErrorBoundary FallbackComponent={Error}>
            <Suspense fallback={<p className='p-6 text-sm'>Loading document…</p>}>
              <DocumentPage active={active} />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
    </RootLayout>
  )
}
