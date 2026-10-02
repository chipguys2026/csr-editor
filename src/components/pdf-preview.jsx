import { useCallback, useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Loader2 } from 'lucide-react'
import './pdf-preview.css'

GlobalWorkerOptions.workerSrc = workerUrl

const PdfPage = ({ pdf, number, width, scrollRef, onNavigate, active }) => {
  const pageRef = useRef(null)
  const canvasRef = useRef(null)
  const textRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [links, setLinks] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!active) return
    let disposed = false
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!disposed) setVisible(entry.isIntersecting)
      },
      {
        root: scrollRef.current,
        rootMargin: '300px',
      }
    )
    observer.observe(pageRef.current)
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [scrollRef, active])

  useEffect(() => {
    if (!visible || width <= 0) return
    let disposed = false
    let renderTask
    let textLayer
    let loadedPage
    const canvas = canvasRef.current
    const textContainer = textRef.current
    pdf
      .getPage(number)
      .then(async (page) => {
        if (disposed) return
        loadedPage = page
        const scale = width / page.getViewport({ scale: 1 }).width
        const viewport = page.getViewport({ scale })
        // Bound a canvas to about 8 MB, including at high zoom and pixel density.
        const pixelRatio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(2_000_000 / (viewport.width * viewport.height))
        )
        canvas.width = Math.ceil(viewport.width * pixelRatio)
        canvas.height = Math.ceil(viewport.height * pixelRatio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        textContainer.style.setProperty('--total-scale-factor', scale)
        textContainer.style.setProperty('--scale-round-x', '1px')
        textContainer.style.setProperty('--scale-round-y', '1px')
        renderTask = page.render({
          canvasContext: canvas.getContext('2d'),
          viewport,
          transform:
            pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        })
        textLayer = new TextLayer({
          container: textContainer,
          textContentSource: page.streamTextContent(),
          viewport,
        })
        const [, , annotations] = await Promise.all([
          renderTask.promise,
          textLayer.render(),
          page.getAnnotations(),
        ])
        if (disposed) return
        setLinks(
          annotations
            .filter(
              (annotation) => annotation.subtype === 'Link' && annotation.dest
            )
            .map((annotation) => {
              const [x1, y1] = viewport.convertToViewportPoint(
                annotation.rect[0],
                annotation.rect[1]
              )
              const [x2, y2] = viewport.convertToViewportPoint(
                annotation.rect[2],
                annotation.rect[3]
              )
              return {
                id: annotation.id,
                dest: annotation.dest,
                left: Math.min(x1, x2),
                top: Math.min(y1, y2),
                width: Math.abs(x2 - x1),
                height: Math.abs(y2 - y1),
              }
            })
        )
        setError(null)
      })
      .catch((reason) => {
        if (!disposed) setError(reason.message)
      })
    return () => {
      disposed = true
      renderTask?.cancel()
      textLayer?.cancel()
      textContainer.replaceChildren()
      canvas.width = 0
      canvas.height = 0
      if (renderTask) {
        renderTask.promise.catch(() => {}).then(() => loadedPage?.cleanup())
      } else {
        loadedPage?.cleanup()
      }
    }
  }, [pdf, number, width, visible])

  return (
    <section
      ref={pageRef}
      data-pdf-page={number}
      aria-label={`Page ${number}`}
      className='relative shrink-0 bg-white shadow-md'
      style={{ width, aspectRatio: '595.28 / 841.89' }}
    >
      <canvas
        ref={canvasRef}
        width={0}
        height={0}
        aria-hidden='true'
        className='absolute inset-0'
      />
      <div
        ref={textRef}
        className='csr-pdf-text-layer'
      />
      {visible &&
        links.map((annotation) => (
          <button
            key={annotation.id}
            type='button'
            aria-label={
              typeof annotation.dest === 'string'
                ? `Go to ${annotation.dest}`
                : 'Go to linked section'
            }
            className='absolute cursor-pointer bg-transparent hover:bg-blue-500/10 focus-visible:outline-2 focus-visible:outline-blue-500'
            style={{
              left: annotation.left,
              top: annotation.top,
              width: annotation.width,
              height: annotation.height,
            }}
            onClick={() =>
              onNavigate(annotation.dest).catch((reason) =>
                setError(reason.message)
              )
            }
          />
        ))}
      {error && (
        <p
          role='alert'
          className='absolute inset-x-4 top-4 text-sm text-red-700'
        >
          Unable to preview page {number}: {error}
        </p>
      )}
      <span
        aria-hidden='true'
        className='text-muted-foreground absolute -bottom-6 left-0 w-full text-center text-xs'
      >
        {number}
      </span>
    </section>
  )
}

/** Render PDF pages in the app, with selectable text and internal links. */
export const PdfPreview = ({
  active = true,
  url,
  navigation,
  contents,
  zoom,
  onActiveSection,
}) => {
  const scrollRef = useRef(null)
  const [pdf, setPdf] = useState(null)
  const [error, setError] = useState(null)
  const [containerWidth, setContainerWidth] = useState(800)
  const destinationsRef = useRef([])
  const lastNavigationRef = useRef(null)
  const scrollFrameRef = useRef(null)
  const width = Math.max(240, Math.min(850, containerWidth - 48) * zoom)

  useEffect(() => {
    if (!active) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(scrollRef.current)
    return () => observer.disconnect()
  }, [active])

  useEffect(() => {
    let disposed = false
    const task = getDocument({ url, useSystemFonts: true })
    task.promise
      .then(async (document) => {
        if (disposed) return
        // Show the first page without waiting for the entire navigation index.
        setPdf(document)
        const namedDestinations = await document.getDestinations()
        if (disposed) return
        const pagePromises = new Map()
        const destinations = await Promise.all(
          contents.map(async (entry) => {
            const dest = namedDestinations[entry.id]
            if (!dest) return null
            const index = await document.getPageIndex(dest[0])
            if (!pagePromises.has(index))
              pagePromises.set(index, document.getPage(index + 1))
            const page = await pagePromises.get(index)
            const viewport = page.getViewport({ scale: 1 })
            const [, y] = viewport.convertToViewportPoint(
              dest[2] ?? 0,
              dest[3] ?? viewport.height
            )
            return {
              id: entry.id,
              page: index + 1,
              y,
              pageWidth: viewport.width,
            }
          })
        )
        if (disposed) return
        destinationsRef.current = destinations.filter(Boolean)
      })
      .catch((reason) => {
        if (!disposed) setError(reason.message)
      })
    return () => {
      disposed = true
      task.destroy()
    }
  }, [url, contents])

  const navigate = useCallback(
    async (destination) => {
      if (!pdf) return
      const dest =
        typeof destination === 'string'
          ? await pdf.getDestination(destination)
          : destination
      if (!dest) return
      const index = await pdf.getPageIndex(dest[0])
      const page = await pdf.getPage(index + 1)
      const viewport = page.getViewport({
        scale: width / page.getViewport({ scale: 1 }).width,
      })
      const [, y] = viewport.convertToViewportPoint(
        dest[2] ?? 0,
        dest[3] ?? page.view[3]
      )
      const container = scrollRef.current
      const element = container?.querySelector(`[data-pdf-page="${index + 1}"]`)
      if (!element) return
      const top =
        element.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop +
        y -
        16
      container.scrollTo({ top, behavior: 'smooth' })
    },
    [pdf, width]
  )

  useEffect(() => {
    if (active && pdf && navigation && lastNavigationRef.current !== navigation) {
      lastNavigationRef.current = navigation
      navigate(navigation.id).catch((reason) => setError(reason.message))
    }
  }, [active, pdf, navigation, navigate])

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null)
        cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
  }, [active])

  const onScroll = () => {
    if (!active || scrollFrameRef.current !== null) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      const container = scrollRef.current
      const atBottom =
        container.scrollTop + container.clientHeight >= container.scrollHeight - 2
      const top =
        container.getBoundingClientRect().top +
        (atBottom ? container.clientHeight : 40)
      const pageTops = new Map()
      let activeId = destinationsRef.current[0]?.id
      for (const destination of destinationsRef.current) {
        if (!pageTops.has(destination.page)) {
          const element = container.querySelector(
            `[data-pdf-page="${destination.page}"]`
          )
          pageTops.set(destination.page, element?.getBoundingClientRect().top)
        }
        const pageTop = pageTops.get(destination.page)
        if (
          pageTop !== undefined &&
          pageTop + (destination.y * width) / destination.pageWidth <= top
        )
          activeId = destination.id
      }
      if (activeId) onActiveSection(activeId)
    })
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className='bg-muted/30 relative min-h-0 flex-1 overflow-auto'
    >
      {error ? (
        <p
          role='alert'
          className='p-6 text-sm'
        >
          Unable to preview PDF: {error}. You can still download it.
        </p>
      ) : !pdf ? (
        <div
          role='status'
          className='text-muted-foreground flex h-full items-center justify-center gap-2 text-sm'
        >
          <Loader2 className='h-4 w-4 animate-spin' />
          Preparing preview…
        </div>
      ) : (
        <div className='flex min-w-max flex-col items-center gap-10 px-6 pt-6 pb-10'>
          {Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPage
              key={index}
              active={active}
              pdf={pdf}
              number={index + 1}
              width={width}
              scrollRef={scrollRef}
              onNavigate={navigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}
