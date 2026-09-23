import { useMemo } from 'react'
import { toast } from 'sonner'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { CodeView, SidebarItem, ViewShell } from '@/components/view-shell'
import { codeColors } from '@/lib/code-colors'
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
 * being done to it. Coloured as the RTL is: commands as its keywords, the Tcl
 * substitutions as its directives.
 */
const renderLine = (line) => {
  if (line.trimStart().startsWith('#')) {
    return <span className={codeColors.comment}>{line}</span>
  }

  return line
    .split(/([A-Za-z_]\w*|\$\w+|"[^"]*"|\b\d+\b)/)
    .map((part, index) => {
      let className = null

      if (SDC_COMMANDS.has(part)) {
        className = codeColors.keyword
      } else if (part.startsWith('$') || part.startsWith('"')) {
        className = codeColors.directive
      } else if (/^\d+$/.test(part)) {
        className = codeColors.number
      }

      return (
        <span
          key={index}
          className={className ?? undefined}
        >
          {part}
        </span>
      )
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
        error:
          cause instanceof Error ? cause.message : 'Failed to generate SDC',
      }
    }
  }, [params, registers])

  const lines = useMemo(() => (file ? file.content.split('\n') : []), [file])
  const marked = countQuasiStaticFields(registers)

  return (
    <ViewShell
      error={error}
      sidebarTitle='Files'
      sidebarSubtitle='1 generated file(s)'
      sidebar={file && <SidebarItem active>{file.name}</SidebarItem>}
      title={file?.name}
      subtitle={
        marked === 0
          ? 'No field is marked quasi-static'
          : `${marked} field(s) cut, ${lines.length} lines`
      }
      actions={
        file && (
          <>
            <Select
              value={params.sdcTarget ?? 'synopsys'}
              onValueChange={(value) => setParams({ sdcTarget: value })}
            >
              <SelectTrigger
                size='sm'
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
              size='sm'
              className='gap-2'
              onClick={() => {
                downloadFile(file.name, file.content)
                toast.success(`Downloaded ${file.name}`)
              }}
            >
              <Download className='h-4 w-4' />
              Download SDC
            </Button>
          </>
        )
      }
    >
      <CodeView
        label='Constraint'
        lines={lines}
        renderLine={renderLine}
      />
    </ViewShell>
  )
}

export default SDCPage
