import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { generateRtlFiles } from '@/lib/csr-rtl'
import { CodeView, SidebarItem, ViewShell } from '@/components/view-shell'
import { codeColors } from '@/lib/code-colors'
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

    let className = codeColors.text
    if (token.startsWith('`')) {
      className = codeColors.directive
    } else if (VERILOG_KEYWORDS.has(token)) {
      className = codeColors.keyword
    } else if (/^\d/.test(token)) {
      className = codeColors.number
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
      {hasComment && <span className={codeColors.comment}>{comment}</span>}
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
    <ViewShell
      error={error}
      sidebarTitle='Files'
      sidebarSubtitle={`${files.length} generated file(s)`}
      sidebar={files.map((file) => (
        <SidebarItem
          key={file.name}
          active={file.name === activeFile?.name}
          onClick={() => setSelectedFileName(file.name)}
        >
          {file.name}
        </SidebarItem>
      ))}
      title={activeFile?.name ?? 'No file'}
      subtitle={`${activeLines.length} lines`}
      actions={
        <>
          {files.length > 0 && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='gap-2'
              onClick={() => {
                downloadAllFiles(files)
                toast.success(`Downloading ${files.length} RTL file(s)`)
              }}
            >
              <Download className='h-4 w-4' />
              Download All
            </Button>
          )}

          {activeFile && (
            <Button
              type='button'
              size='sm'
              className='gap-2'
              onClick={() => {
                downloadFile(activeFile.name, activeFile.content)
                toast.success(`Downloaded ${activeFile.name}`)
              }}
            >
              <Download className='h-4 w-4' />
              Download File
            </Button>
          )}
        </>
      }
    >
      <CodeView
        label='Code'
        lines={activeLines}
        renderLine={renderHighlightedLine}
        keyPrefix={activeFile?.name ?? 'empty'}
      />
    </ViewShell>
  )
}

export default RTLPage
