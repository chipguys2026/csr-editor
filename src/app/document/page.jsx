import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowUp, FileDown, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { RegisterDiagram } from '@/components/register-diagram'
import { accessFillOf } from '@/lib/access-types'
import { buildDocument } from '@/lib/csr-document'
import { exportRegisterPdf } from '@/lib/pdf-export'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { cn } from '@/lib/utils'

const cell = 'border px-2 py-1 text-left align-top'
const MAP_ID = 'register-map'
const headCell = `${cell} bg-muted font-semibold`

const Prose = ({ text, className }) =>
  text ? (
    <p className={`whitespace-pre-wrap ${className ?? ''}`}>{text}</p>
  ) : null

const FieldDescription = ({ row }) => (
  <div className='space-y-1'>
    <Prose text={row.description} />
    {row.notes.map((note) => (
      <p
        key={note}
        className='text-muted-foreground italic'
      >
        {note}
      </p>
    ))}
    {row.enumValues.length > 0 && (
      <ul className='space-y-0.5'>
        {row.enumValues.map((entry) => (
          <li key={`${entry.label}-${entry.name}`}>
            <span className='font-mono'>{entry.label}</span> ={' '}
            <span className='font-mono font-medium'>{entry.name}</span>
            {entry.description && ` - ${entry.description}`}
          </li>
        ))}
      </ul>
    )}
  </div>
)

const RegisterSection = ({ reg, dataWidth }) => (
  <section
    id={reg.id}
    className='scroll-mt-4 space-y-3'
  >
    {/* Heading, prose and diagram stay together: a page that ends on a
        register name with its fields overleaf reads as a missing register. */}
    <div className='break-inside-avoid space-y-3'>
      <h3 className='flex flex-wrap items-baseline gap-x-3 border-b pb-1 text-lg font-semibold'>
        <span className='font-mono'>{reg.name}</span>
        <span className='text-muted-foreground font-mono text-sm font-normal'>
          {reg.address}
          {reg.range && ` (${reg.range})`}
        </span>
        <span className='text-muted-foreground ml-auto font-mono text-sm font-normal'>
          Reset {reg.resetValue}
        </span>
      </h3>

      <Prose
        text={reg.description}
        className='text-sm'
      />

      {/* The diagram is drawn at a fixed pixel size; scale it to the column
          so it fits a narrow window as well as a wide one. */}
      <div className='overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full'>
        <RegisterDiagram
          fields={reg.diagramFields}
          dataWidth={dataWidth}
        />
      </div>
    </div>

    <table className='w-full border-collapse text-xs'>
      <thead>
        <tr>
          <th className={`${headCell} w-24`}>Bits</th>
          <th className={`${headCell} w-40`}>Field</th>
          <th className={`${headCell} w-16`}>Access</th>
          <th className={`${headCell} w-20`}>Reset</th>
          <th className={headCell}>Description</th>
        </tr>
      </thead>
      <tbody>
        {reg.rows.map((row) => (
          <tr
            key={row.bits}
            className={`break-inside-avoid ${row.reserved ? 'text-muted-foreground' : ''}`}
          >
            <td className={`${cell} font-mono`}>{row.bits}</td>
            <td className={`${cell} font-mono break-all`}>{row.name}</td>
            <td className={`${cell} font-mono`}>{row.access}</td>
            <td className={`${cell} font-mono`}>{row.reset}</td>
            <td className={cell}>
              {row.reserved ? 'Reserved' : <FieldDescription row={row} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>

    <a
      href={`#${MAP_ID}`}
      className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs'
    >
      <ArrowUp className='h-3 w-3' />
      Back to register map
    </a>
  </section>
)

/**
 * The page's contents, down the left. It follows the reading position, so
 * in a long map it says which register is on screen as well as where the
 * others are.
 */
const Contents = ({ entries, activeId }) => {
  const listRef = useRef(null)

  // Keep the current entry in view as the document scrolls past the end of
  // what the sidebar shows.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-toc="${activeId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return (
    <nav
      ref={listRef}
      className='w-60 shrink-0 overflow-auto border-r p-2 text-sm'
    >
      {entries.map((entry) => (
        <a
          key={entry.id}
          href={`#${entry.id}`}
          data-toc={entry.id}
          className={cn(
            'flex items-baseline gap-2 rounded-md px-2 py-1 transition-colors',
            entry.register ? 'pl-5 font-mono text-xs' : 'font-medium',
            entry.id === activeId
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/60'
          )}
        >
          <span className='truncate'>{entry.label}</span>
          {entry.detail && (
            <span className='text-muted-foreground ml-auto shrink-0'>
              {entry.detail}
            </span>
          )}
        </a>
      ))}
    </nav>
  )
}

/**
 * Which section is being read: the last one whose top has scrolled past a
 * line a little below the top of the view.
 */
const useActiveSection = (containerRef, ids) => {
  const [activeId, setActiveId] = useState(ids[0])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    let frame = null

    const update = () => {
      frame = null
      const line = container.getBoundingClientRect().top + 80
      let current = ids[0]

      for (const id of ids) {
        const element = document.getElementById(id)
        if (element && element.getBoundingClientRect().top <= line) {
          current = id
        }
      }

      // At the very bottom the last sections may never reach the line.
      if (
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 2
      ) {
        current = ids.at(-1)
      }

      setActiveId(current)
    }

    const onScroll = () => {
      frame ??= requestAnimationFrame(update)
    }

    container.addEventListener('scroll', onScroll)
    onScroll()

    return () => {
      container.removeEventListener('scroll', onScroll)
      if (frame != null) cancelAnimationFrame(frame)
    }
  }, [containerRef, ids])

  return activeId
}

const DocumentPage = () => {
  const params = useParamStore()
  const registers = useRegisterStore((state) => state.registers)
  const [exporting, setExporting] = useState(false)

  const doc = useMemo(
    () => buildDocument(params, registers),
    [params, registers]
  )
  const dataWidth = Number(params.dataWidth ?? 32)

  const scrollRef = useRef(null)
  const contents = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      ...(doc.parameters.length > 0
        ? [{ id: 'parameters', label: 'Parameters' }]
        : []),
      ...(doc.accessTypes.length > 0
        ? [{ id: 'access-types', label: 'Access Types' }]
        : []),
      { id: MAP_ID, label: 'Register Map' },
      ...doc.registers.map((reg) => ({
        id: reg.id,
        label: reg.name,
        detail: reg.address.split(' ')[0],
        register: true,
      })),
    ],
    [doc]
  )
  const contentIds = useMemo(
    () => contents.map((entry) => entry.id),
    [contents]
  )
  const activeId = useActiveSection(scrollRef, contentIds)

  const onExport = async () => {
    setExporting(true)
    try {
      toast.success(`Downloaded ${await exportRegisterPdf(params, registers)}`)
    } catch (error) {
      console.error(error)
      toast.error('Failed to export PDF')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex items-center justify-between border-b px-4 py-2'>
        <p className='text-muted-foreground text-sm'>Register datasheet</p>
        <Button
          size='sm'
          className='gap-2'
          disabled={exporting}
          onClick={onExport}
        >
          {exporting ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <FileDown className='h-4 w-4' />
          )}
          Download PDF
        </Button>
      </div>

      <div className='flex min-h-0 flex-1'>
        <Contents
          entries={contents}
          activeId={activeId}
        />

        <div
          ref={scrollRef}
          className='min-h-0 flex-1 overflow-auto scroll-smooth'
        >
          <article className='mx-auto max-w-5xl space-y-8 p-8'>
            <header
              id='overview'
              className='scroll-mt-4 space-y-4'
            >
              <h1 className='text-3xl font-bold'>
                {doc.title} Register Specification
              </h1>

              <table className='border-collapse text-sm'>
                <tbody>
                  {doc.summary.map(([label, value]) => (
                    <tr key={label}>
                      <th className={`${headCell} w-40`}>{label}</th>
                      <td className={`${cell} font-mono`}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </header>

            {doc.parameters.length > 0 && (
              <section
                id='parameters'
                className='scroll-mt-4 break-inside-avoid space-y-2'
              >
                <h2 className='text-xl font-semibold'>Parameters</h2>
                <table className='border-collapse text-sm'>
                  <thead>
                    <tr>
                      <th className={headCell}>Name</th>
                      <th className={headCell}>Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.parameters.map((entry) => (
                      <tr key={entry.name}>
                        <td className={`${cell} font-mono`}>{entry.name}</td>
                        <td className={`${cell} font-mono`}>{entry.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {doc.accessTypes.length > 0 && (
              <section
                id='access-types'
                className='scroll-mt-4 break-inside-avoid space-y-2'
              >
                <h2 className='text-xl font-semibold'>Access Types</h2>
                <table className='w-full border-collapse text-sm'>
                  <tbody>
                    {doc.accessTypes.map((entry) => (
                      <tr key={entry.type}>
                        <th
                          className={`${cell} w-20 font-mono font-semibold text-neutral-900`}
                          style={{ backgroundColor: accessFillOf(entry.type) }}
                        >
                          {entry.type}
                        </th>
                        <td className={cell}>{entry.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <section
              id={MAP_ID}
              className='scroll-mt-4 space-y-2'
            >
              <h2 className='text-xl font-semibold'>Register Map</h2>
              {doc.registers.length === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  No registers defined.
                </p>
              ) : (
                <table className='w-full border-collapse text-sm'>
                  <thead>
                    <tr>
                      <th className={`${headCell} w-56`}>Address</th>
                      <th className={`${headCell} w-48`}>Register</th>
                      <th className={`${headCell} w-28`}>Reset</th>
                      <th className={headCell}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.registers.map((reg) => (
                      <tr
                        key={reg.id}
                        className='break-inside-avoid'
                      >
                        <td className={`${cell} font-mono`}>
                          {reg.address}
                          {reg.range && (
                            <div className='text-muted-foreground text-xs'>
                              {reg.range}
                            </div>
                          )}
                        </td>
                        <td className={`${cell} font-mono`}>
                          <a
                            href={`#${reg.id}`}
                            className='underline-offset-2 hover:underline'
                          >
                            {reg.name}
                          </a>
                        </td>
                        <td className={`${cell} font-mono`}>
                          {reg.resetValue}
                        </td>
                        {/* First line only: the full text is in the register's
                          own section. */}
                        <td className={cell}>
                          {reg.description.split('\n')[0]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {doc.registers.length > 0 && (
              <div className='space-y-10'>
                <h2 className='break-after-avoid text-xl font-semibold'>
                  Registers
                </h2>
                {doc.registers.map((reg) => (
                  <RegisterSection
                    key={reg.id}
                    reg={reg}
                    dataWidth={dataWidth}
                  />
                ))}
              </div>
            )}
          </article>
        </div>
      </div>
    </div>
  )
}

export default DocumentPage
