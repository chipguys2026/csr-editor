import { useMemo } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import {
  SDC_TARGETS,
  countQuasiStaticFields,
  generateSdcFiles,
} from '@/lib/csr-sdc'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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

const SDC_COMMANDS = new Set([
  'set',
  'set_false_path',
  'set_max_delay',
  'set_multicycle_path',
  'if',
  'info',
  'get_cells',
  'get_registers',
  'get_pins',
  'get_ports',
])

/**
 * Enough highlighting to tell a constraint from the commentary around it: the
 * comments carry which field a line belongs to, and the commands carry what is
 * being done to it.
 */
const renderLine = (line) => {
  if (line.trimStart().startsWith('#')) {
    return <span className='text-emerald-600 dark:text-emerald-400'>{line}</span>
  }

  return line
    .split(/([A-Za-z_]\w*|\$\w+|"[^"]*")/)
    .map((part, index) => {
      if (SDC_COMMANDS.has(part)) {
        return (
          <span key={index} className='text-violet-600 dark:text-violet-400'>
            {part}
          </span>
        )
      }

      if (part.startsWith('$') || part.startsWith('"')) {
        return (
          <span key={index} className='text-sky-700 dark:text-sky-300'>
            {part}
          </span>
        )
      }

      return <span key={index}>{part}</span>
    })
}

const SDCPage = () => {
  const params = useParamStore()
  const setParams = useParamStore((state) => state.setParams)
  const registers = useRegisterStore((state) => state.registers)

  // A map the generator refuses is reported here rather than thrown at the
  // error boundary, the same way the RTL and header views report it.
  const { file, error } = useMemo(() => {
    try {
      return { file: generateSdcFiles({ params, registers })[0], error: null }
    } catch (cause) {
      return {
        file: null,
        error: cause instanceof Error ? cause.message : 'Failed to generate SDC',
      }
    }
  }, [params, registers])

  const lines = useMemo(() => (file ? file.content.split('\n') : []), [file])
  const marked = countQuasiStaticFields(registers)

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
            {marked === 0
              ? 'No field is marked quasi-static'
              : `${marked} field(s) cut, ${lines.length} lines`}
          </p>
        </div>

        <div className='flex items-center gap-2'>
          <Select
            value={params.sdcTarget ?? 'synopsys'}
            onValueChange={(value) => setParams({ sdcTarget: value })}
          >
            <SelectTrigger
              className='w-48'
              title='Object naming follows the synthesis tool, and does not carry between them'
            >
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              {Object.entries(SDC_TARGETS).map(([value, target]) => (
                <SelectItem
                  key={value}
                  value={value}
                  title={target.note}
                >
                  {target.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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
      </div>

      <div className='bg-muted/30 text-muted-foreground grid grid-cols-[56px_1fr] border-b px-4 py-2 text-xs font-medium tracking-wide uppercase'>
        <div>Line</div>
        <div>Constraint</div>
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

export default SDCPage
