import { useRoutes } from 'react-router-dom'
import { ErrorBoundary } from 'react-error-boundary'
import { lazy } from 'react'
import RootLayout from '@/app/layout'
import Error from '@/app/error'
import NotFound from '@/app/not-found.jsx'

const pages = import.meta.glob('./app/**/page.jsx')
const layouts = import.meta.glob('./app/**/layout.jsx')

const Wrapper = ({ layouts, children }) => {
  if (layouts.length == 0) return children
  return layouts.reduce((acc, Layout) => <Layout>{acc}</Layout>, children)
}

const routes = Object.entries(pages).map(([path, module]) => {
  const appliedLayouts = Object.entries(layouts)
    .filter(([layoutPath, _]) => {
      const normalizedPath = path.replace(/.*\/app/, '').replace('/page.jsx', '')
      const normalizedLayoutPath = layoutPath.replace(/.*\/app/, '').replace('/layout.jsx', '')

      return normalizedLayoutPath && normalizedPath.startsWith(normalizedLayoutPath)
    })
    .sort(([path_1, _], [path_2, __]) => path_1.length - path_2.length)
    .map(([_, layout]) => lazy(layout))

  const route = path
    .replace(/.*\/app/, '')
    .replace('/page.jsx', '')
    .replace(/\[(.*?)\]/g, ':$1')
    .replace(/\/\((.*?)\)/g, '')

  const Page = lazy(module)

  return {
    path: route || '/',
    element: (
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
  return <RootLayout>{useRoutes(routes)}</RootLayout>
}
