import { useMemo } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { generateHeaderFile } from '@/lib/csr-header'

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

/**
 * Enough highlighting to tell the three things in this file apart: the
 * directives, the prose carried over from the register map, and the numbers.
 */
const renderLine = (line) => {
  if (line.trimStart().startsWith('/*') || line.trimStart().startsWith('*')) {
    return <span className='text-emerald-600 dark:text-emerald-400'>{line}</span>
  }

  const match = line.match(/^(#\w+)(\s+)(\S*)([\s\S]*)$/)

  if (!match) {
    return line
  }

  const [, directive, gap, name, rest] = match

  return (
    <>
      <span className='text-violet-600 dark:text-violet-400'>{directive}</span>
      {gap}
      <span className='text-sky-700 dark:text-sky-300'>{name}</span>
      {rest.split(/(\/\*.*?\*\/)/).map((part, index) =>
        part.startsWith('/*') ? (
          <span key={index} className='text-muted-foreground'>
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}

const HeaderPage = () => {
  const params = useParamStore()
  const registers = useRegisterStore((state) => state.registers)

  // A map the generator refuses is reported here rather than thrown at the
  // error boundary, the same way the RTL view reports it.
  const { file, error } = useMemo(() => {
    try {
      return { file: generateHeaderFile(params, registers), error: null }
    } catch (cause) {
      return {
        file: null,
        error: cause instanceof Error ? cause.message : 'Failed to generate header',
      }
    }
  }, [params, registers])

  const lines = useMemo(() => (file ? file.content.split('\n') : []), [file])
  const count = Object.keys(registers).length

  if (error) {
    return (
      <div className='m-4 flex flex-1 flex-col overflow-hidden rounded-lg border'>
        <div className='rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300'>
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className='m-4 flex flex-1 flex-col overflow-hidden rounded-lg border'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3'>
        <div>
          <h3 className='font-medium'>{file.name}</h3>
          <p className='text-muted-foreground text-xs'>
            {count} register(s), {lines.length} lines
          </p>
        </div>

        <Button
          type='button'
          variant='secondary'
          onClick={() => {
            downloadFile(file.name, file.content)
            toast.success(`Downloaded ${file.name}`)
          }}
        >
          Download
        </Button>
      </div>

      <div className='bg-muted/30 text-muted-foreground grid grid-cols-[56px_1fr] border-b px-4 py-2 text-xs font-medium tracking-wide uppercase'>
        <div>Line</div>
        <div>Header</div>
      </div>

      <div className='min-h-0 flex-1 overflow-auto'>
        <div className='font-mono text-xs leading-6'>
          {lines.map((line, index) => (
            <div
              key={index}
              className='hover:bg-muted/20 grid grid-cols-[56px_1fr] px-4'
            >
              <div className='text-muted-foreground pr-4 text-right select-none'>
                {index + 1}
              </div>
              <pre className='overflow-x-auto break-words whitespace-pre-wrap'>
                {renderLine(line || ' ')}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default HeaderPage
