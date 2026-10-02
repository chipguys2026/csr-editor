import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, Loader2, Minus, Plus, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarItem, ViewShell } from '@/components/view-shell'
import { PdfPreview } from '@/components/pdf-preview'
import { buildDocument } from '@/lib/csr-document'
import {
  createRegisterPdf,
  discardStaleRegisterPdf,
  downloadRegisterPdf,
  getCachedRegisterPdf,
} from '@/lib/pdf-export'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'

const DocumentPage = ({ active = true }) => {
  // Compare PDF inputs by value: form validation also clones parameter arrays.
  const paramsJson = useParamStore((state) => JSON.stringify({
    moduleName: state.moduleName,
    dataWidth: state.dataWidth,
    addrWidth: state.addrWidth,
    interface: state.interface,
    parameters: state.parameters,
    registeredReadback: state.registeredReadback,
  }))
  const params = useMemo(() => JSON.parse(paramsJson), [paramsJson])
  const registers = useRegisterStore((state) => state.registers)
  const doc = useMemo(
    () => buildDocument(params, registers),
    [params, registers]
  )
  const dataWidth = Number(params.dataWidth ?? 32)
  const [result, setResult] = useState(() => {
    const cached = getCachedRegisterPdf(doc, dataWidth)
    return cached ? { ...cached, doc, dataWidth, revision: 0 } : null
  })
  const [revision, setRevision] = useState(0)
  const [selectedId, setSelectedId] = useState('overview')
  const [navigation, setNavigation] = useState(null)
  const [zoom, setZoom] = useState(1)
  const contents = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      ...(doc.parameters.length
        ? [{ id: 'parameters', label: 'Parameters' }]
        : []),
      { id: 'access-types', label: 'Access Types' },
      { id: 'register-map', label: 'Register Map' },
      ...doc.registers.map((reg) => ({
        id: reg.id,
        label: reg.name,
        address: reg.address,
      })),
    ],
    [doc]
  )

  useEffect(() => {
    if (!active) {
      discardStaleRegisterPdf(doc, dataWidth)
      return
    }
    const controller = new AbortController()
    // Debounce edits; a cached PDF needs no delay when returning to this page.
    const timer = setTimeout(() => {
      createRegisterPdf(doc, dataWidth, controller.signal)
        .then((generated) => {
          if (controller.signal.aborted) return
          setResult({
            doc,
            dataWidth,
            revision,
            url: generated.url,
            pageNumbers: generated.pageNumbers,
          })
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          setResult({ doc, dataWidth, revision, error: error.message })
        })
    }, getCachedRegisterPdf(doc, dataWidth) ? 0 : 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [active, doc, dataWidth, revision])

  const current =
    result?.doc === doc &&
    result?.dataWidth === dataWidth &&
    result?.revision === revision
      ? result
      : null
  const activeId = contents.some((entry) => entry.id === selectedId)
    ? selectedId
    : 'overview'

  return (
    <ViewShell
      layoutKey='documentSidebar'
      sidebarTitle='Contents'
      sidebarSubtitle={`${doc.registers.length} register(s)`}
      title={`${doc.title}_registers.pdf`}
      subtitle='Register datasheet'
      sidebar={contents.map((entry) => (
        <SidebarItem
          key={entry.id}
          active={activeId === entry.id}
          disabled={!current?.url}
          onClick={() => {
            setSelectedId(entry.id)
            setNavigation({ id: entry.id })
          }}
        >
          <span className='min-w-0 flex-1'>
            <span
              className={
                entry.address ? 'block truncate font-mono' : 'block truncate'
              }
            >
              {entry.label}
            </span>
            {entry.address && (
              <span className='text-muted-foreground block truncate font-mono text-xs'>
                {entry.address}
              </span>
            )}
          </span>
          {current?.pageNumbers?.[entry.id] && (
            <span className='text-muted-foreground ml-2 text-xs'>
              {current.pageNumbers[entry.id]}
            </span>
          )}
        </SidebarItem>
      ))}
      actions={
        <>
          <Button
            size='icon'
            variant='ghost'
            aria-label='Zoom out'
            disabled={zoom <= 0.5}
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          >
            <Minus className='h-4 w-4' />
          </Button>
          <Button
            size='sm'
            variant='ghost'
            title='Reset zoom'
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </Button>
          <Button
            size='icon'
            variant='ghost'
            aria-label='Zoom in'
            disabled={zoom >= 2}
            onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
          >
            <Plus className='h-4 w-4' />
          </Button>
          <Button
            size='sm'
            disabled={!current?.url}
            onClick={() =>
              toast.success(
                `Downloaded ${downloadRegisterPdf(current.url, doc.title)}`
              )
            }
          >
            {!current ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <Download className='h-4 w-4' />
            )}
            Download PDF
          </Button>
        </>
      }
    >
      {!current ? (
        <div
          role='status'
          className='text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm'
        >
          <Loader2 className='h-4 w-4 animate-spin' />
          Preparing document…
        </div>
      ) : current.error ? (
        <div
          role='alert'
          className='flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm'
        >
          <p>Unable to generate PDF: {current.error}</p>
          <Button
            variant='outline'
            onClick={() => setRevision((value) => value + 1)}
          >
            <RotateCw className='h-4 w-4' />
            Retry
          </Button>
        </div>
      ) : (
        <PdfPreview
          key={current.url}
          active={active}
          url={current.url}
          navigation={navigation}
          contents={contents}
          zoom={zoom}
          onActiveSection={setSelectedId}
        />
      )}
    </ViewShell>
  )
}

export default DocumentPage
