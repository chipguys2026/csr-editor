import { useMemo } from 'react'
import { toast } from 'sonner'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { generateHeaderFile } from '@/lib/csr-header'
import { CodeView, SidebarItem, ViewShell } from '@/components/view-shell'
import { codeColors } from '@/lib/code-colors'

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

/** Numbers in a C line: hex or decimal, with any unsigned/long suffix. */
const NUMBER = /(\b0[xX][0-9a-fA-F]+[uUlL]*\b|\b\d+[uUlL]*\b)/

const renderNumbers = (text) =>
  text.split(NUMBER).map((part, index) =>
    NUMBER.test(part) ? (
      <span
        key={index}
        className={codeColors.number}
      >
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    )
  )

/**
 * Enough highlighting to tell the three things in this file apart: the
 * directives, the prose carried over from the register map, and the numbers.
 * Coloured as the RTL is, a #define as its `define.
 */
const renderLine = (line) => {
  if (line.trimStart().startsWith('/*') || line.trimStart().startsWith('*')) {
    return <span className={codeColors.comment}>{line}</span>
  }

  const match = line.match(/^(#\w+)(\s+)(\S*)([\s\S]*)$/)

  if (!match) {
    return renderNumbers(line)
  }

  const [, directive, gap, name, rest] = match

  return (
    <>
      <span className={codeColors.directive}>{directive}</span>
      {gap}
      {name}
      {rest.split(/(\/\*.*?\*\/)/).map((part, index) =>
        part.startsWith('/*') ? (
          <span
            key={index}
            className={codeColors.comment}
          >
            {part}
          </span>
        ) : (
          <span key={index}>{renderNumbers(part)}</span>
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
        error:
          cause instanceof Error ? cause.message : 'Failed to generate header',
      }
    }
  }, [params, registers])

  const lines = useMemo(() => (file ? file.content.split('\n') : []), [file])
  const count = Object.keys(registers).length

  return (
    <ViewShell
      error={error}
      sidebarTitle='Files'
      sidebarSubtitle='1 generated file(s)'
      sidebar={file && <SidebarItem active>{file.name}</SidebarItem>}
      title={file?.name}
      subtitle={`${count} register(s), ${lines.length} lines`}
      actions={
        file && (
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
            Download Header
          </Button>
        )
      }
    >
      <CodeView
        label='Header'
        lines={lines}
        renderLine={renderLine}
      />
    </ViewShell>
  )
}

export default HeaderPage
