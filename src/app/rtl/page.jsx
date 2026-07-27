import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { generateRtlFiles } from '@/lib/csr-rtl'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const downloadFile = (filename, content) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const downloadAllFiles = (files) => {
  files.forEach((file, index) => {
    window.setTimeout(() => {
      downloadFile(file.name, file.content)
    }, index * 150)
  })
}

const VERILOG_KEYWORDS = new Set([
  'always',
  'assign',
  'begin',
  'case',
  'default',
  'else',
  'end',
  'endcase',
  'endmodule',
  'if',
  'input',
  'localparam',
  'module',
  'or',
  'output',
  'parameter',
  'posedge',
  'reg',
  'wire',
])

const renderHighlightedSegment = (segment, lineIndex) => {
  const tokenPattern =
    /(`\w+|\b\d+'[bodhBODH][0-9a-fA-F_xXzZ?]+\b|\b\d+\b|\b[A-Za-z_]\w*\b)/g
  const nodes = []
  let lastIndex = 0
  let tokenIndex = 0

  for (const match of segment.matchAll(tokenPattern)) {
    const token = match[0]
    const start = match.index ?? 0

    if (start > lastIndex) {
      nodes.push(
        <span key={`txt-${lineIndex}-${tokenIndex}-${lastIndex}`}>
          {segment.slice(lastIndex, start)}
        </span>
      )
    }

    let className = 'text-zinc-200'
    if (token.startsWith('`')) {
      className = 'text-amber-300'
    } else if (VERILOG_KEYWORDS.has(token)) {
      className = 'text-sky-300'
    } else if (/^\d/.test(token)) {
      className = 'text-emerald-300'
    }

    nodes.push(
      <span
        key={`tok-${lineIndex}-${tokenIndex}`}
        className={className}
      >
        {token}
      </span>
    )

    lastIndex = start + token.length
    tokenIndex += 1
  }

  if (lastIndex < segment.length) {
    nodes.push(
      <span key={`tail-${lineIndex}-${lastIndex}`}>
        {segment.slice(lastIndex)}
      </span>
    )
  }

  return nodes
}

const renderHighlightedLine = (line, lineIndex) => {
  const commentIndex = line.indexOf('//')
  const hasComment = commentIndex >= 0
  const code = hasComment ? line.slice(0, commentIndex) : line
  const comment = hasComment ? line.slice(commentIndex) : ''

  return (
    <>
      {renderHighlightedSegment(code, lineIndex)}
      {hasComment && <span className='text-zinc-500'>{comment}</span>}
    </>
  )
}

const RTLPage = () => {
  const [selectedFileName, setSelectedFileName] = useState(null)
  const dataWidth = useParamStore((state) => state.dataWidth)
  const addrWidth = useParamStore((state) => state.addrWidth)
  const csrInterface = useParamStore((state) => state.interface)
  const moduleName = useParamStore((state) => state.moduleName)
  const parameters = useParamStore((state) => state.parameters)
  const registers = useRegisterStore((state) => state.registers)
  const params = {
    dataWidth,
    addrWidth,
    interface: csrInterface,
    moduleName,
    parameters,
  }

  let files = []
  let error = null

  try {
    files = generateRtlFiles({ params, registers })
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Failed to generate RTL'
  }

  const activeFile = files.find((file) => file.name === selectedFileName) ?? files[0]
  const activeLines = activeFile ? activeFile.content.split('\n') : []

  return (
    <div className='flex flex-1 flex-col gap-4 overflow-auto p-4'>
      {error ? (
        <div className='rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300'>
          {error}
        </div>
      ) : (
        <section className='bg-card flex min-h-0 flex-1 overflow-hidden rounded-lg border'>
          <aside className='flex w-60 shrink-0 flex-col border-r'>
            <div className='border-b px-4 py-3'>
              <p className='text-sm font-medium'>Files</p>
              <p className='text-muted-foreground text-xs'>
                {files.length} generated file(s)
              </p>
            </div>

            <div className='flex-1 overflow-auto p-2'>
              {files.map((file) => (
                <button
                  key={file.name}
                  type='button'
                  className={cn(
                    'flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors',
                    file.name === activeFile?.name
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/60'
                  )}
                  onClick={() => setSelectedFileName(file.name)}
                >
                  {file.name}
                </button>
              ))}
            </div>
          </aside>

          <div className='flex min-w-0 flex-1 flex-col'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3'>
              <h3 className='font-medium'>{activeFile?.name ?? 'No file'}</h3>

              <div className='flex flex-wrap items-center gap-2'>
                {files.length > 0 && (
                  <Button
                    type='button'
                    variant='secondary'
                    onClick={() => {
                      downloadAllFiles(files)
                      toast.success(`Downloading ${files.length} RTL file(s)`)
                    }}
                  >
                    Download All
                  </Button>
                )}

                {activeFile && (
                  <Button
                    type='button'
                    variant='secondary'
                    onClick={() => {
                      downloadFile(activeFile.name, activeFile.content)
                      toast.success(`Downloaded ${activeFile.name}`)
                    }}
                  >
                    Download
                  </Button>
                )}
              </div>
            </div>

            <div className='grid grid-cols-[56px_1fr] border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              <div>Line</div>
              <div>Code</div>
            </div>

            <div className='min-h-0 flex-1 overflow-auto'>
              <div className='font-mono text-xs leading-6'>
                {activeLines.map((line, index) => (
                  <div
                    key={`${activeFile?.name ?? 'empty'}-${index}`}
                    className='grid grid-cols-[56px_1fr] px-4 hover:bg-muted/20'
                  >
                    <div className='select-none pr-4 text-right text-muted-foreground'>
                      {index + 1}
                    </div>
                    <pre className='overflow-x-auto whitespace-pre-wrap break-words text-zinc-200 dark:text-zinc-100'>
                      {renderHighlightedLine(line || ' ', index)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

export default RTLPage
