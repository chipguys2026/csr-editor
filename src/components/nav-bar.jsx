import { Fragment, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import useTheme from '@/hooks/use-theme'

import {
  Braces,
  Cpu,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Info,
  Moon,
  Save,
  SquarePen,
  Sun,
  SunMoon,
  Timer,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import packageInfo from '../../package.json'
import { paramsSchema } from '@/schemas/params-schema'
import { cn } from '@/lib/utils'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { useCurrentRegisterStore } from '@/store/current-register-store'
import { toast } from 'sonner'

/** Theme button: each press moves to the next, and shows where it is now. */
const THEMES = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: SunMoon },
]

/** A thin upright rule between toolbar groups. */
const Divider = () => <div className='bg-border mx-1 h-5 w-px shrink-0' />

const downloadJson = (filename, data) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export const NavBar = () => {
  const { theme, setTheme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const {
    dataWidth,
    addrWidth,
    interface: csrInterface,
    moduleName,
    parameters,
    headerPrefix,
    registeredReadback,
    sdcTarget,
  } = useParamStore()
  const registers = useRegisterStore((state) => state.registers)
  const setParams = useParamStore((state) => state.setParams)
  const setRegisters = useRegisterStore((state) => state.setRegisters)
  const setCurrentRegister = useCurrentRegisterStore(
    (state) => state.setCurrentRegister
  )
  const fileInputRef = useRef(null)
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  // The file the document came from, and is saved back as. Left empty it
  // falls back to the module name, which is what a new document is saved as.
  const [fileName, setFileName] = useState('')
  // Grouped by who reads them: the editor, the documentation, the
  // generated sources. The toolbar draws a divider between groups.
  const viewGroups = [
    [{ label: 'Editor', value: 'editor', path: '/', Icon: SquarePen }],
    [
      {
        label: 'Document',
        value: 'document',
        path: '/document',
        Icon: FileText,
      },
      {
        label: 'Excel',
        value: 'excel',
        path: '/excel',
        Icon: FileSpreadsheet,
      },
    ],
    [
      { label: 'RTL', value: 'rtl', path: '/rtl', Icon: Cpu },
      { label: 'SDC', value: 'sdc', path: '/sdc', Icon: Timer },
      { label: 'C Header', value: 'header', path: '/header', Icon: Braces },
    ],
  ]
  const viewRoutes = viewGroups.flat()
  const currentView =
    viewRoutes.find((route) => route.path === location.pathname)?.value ??
    'editor'

  const onNewJson = () => {
    setParams(paramsSchema.parse({}))
    setRegisters({})
    setCurrentRegister(null)
    setFileName('')
    navigate('/')
    toast.success('Created a new CSR document')
  }

  const onSaveJson = () => {
    const payload = {
      metadata: {
        tool: {
          name: packageInfo.name,
          version: packageInfo.version,
        },
        generatedAt: new Date().toISOString(),
      },
      params: {
        dataWidth,
        addrWidth,
        interface: csrInterface,
        moduleName,
        parameters,
        headerPrefix,
        registeredReadback,
        sdcTarget,
      },
      registers,
    }

    const name = fileName.trim() || `${moduleName}.json`
    downloadJson(/\.json$/i.test(name) ? name : `${name}.json`, payload)
  }

  const onOpenJson = () => {
    fileInputRef.current?.click()
  }

  const onFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      const params = payload?.params
      const importedRegisters = payload?.registers

      if (!params || !importedRegisters) {
        throw new Error('Invalid JSON shape')
      }

      // Anything the file predates falls back to the schema default rather
      // than to undefined, so an older document still opens.
      const nextParams = paramsSchema.parse({
        dataWidth: Number(params.dataWidth),
        addrWidth: Number(params.addrWidth),
        interface: params.interface ?? 'Native',
        moduleName: params.moduleName ?? 'CSR',
        parameters: params.parameters ?? [],
        headerPrefix: params.headerPrefix ?? '',
        registeredReadback: Boolean(params.registeredReadback),
        sdcTarget: params.sdcTarget ?? 'synopsys',
      })

      setParams(nextParams)
      setRegisters(importedRegisters)
      setFileName(file.name)

      const addrKeys = Object.keys(importedRegisters)
      const firstAddr = addrKeys.length
        ? Math.min(...addrKeys.map((key) => Number(key)))
        : null

      if (firstAddr != null && !Number.isNaN(firstAddr)) {
        setCurrentRegister(firstAddr)
      } else {
        setCurrentRegister(null)
      }
    } catch (error) {
      console.error(error)
      toast.error('Failed to open JSON')
    } finally {
      event.target.value = ''
    }
  }

  const themeIndex = Math.max(
    0,
    THEMES.findIndex((entry) => entry.value === theme)
  )
  const { Icon: ThemeIcon, label: themeLabel } = THEMES[themeIndex]
  const nextTheme = THEMES[(themeIndex + 1) % THEMES.length]

  return (
    <>
      <nav className='flex flex-row items-center gap-1 border-b p-2'>
        <h1 className='mr-3 font-bold whitespace-nowrap'>CSR Editor</h1>
        <input
          ref={fileInputRef}
          type='file'
          accept='application/json,.json'
          className='hidden'
          onChange={onFileChange}
        />

        <Button
          variant='ghost'
          size='sm'
          onClick={onNewJson}
          title='Start a new document'
        >
          <FilePlus />
          New
        </Button>
        <Button
          variant='ghost'
          size='sm'
          onClick={onOpenJson}
          title='Open a document from a JSON file'
        >
          <FolderOpen />
          Open
        </Button>
        <Button
          variant='ghost'
          size='sm'
          onClick={onSaveJson}
          title='Save the document as JSON'
        >
          <Save />
          Save
        </Button>

        <Divider />

        <input
          value={fileName}
          onChange={(event) => setFileName(event.target.value)}
          placeholder={`${moduleName}.json`}
          aria-label='File name'
          title='Saved under this name'
          spellCheck={false}
          className='hover:border-input focus:border-input focus:ring-ring/50 h-8 min-w-24 flex-1 rounded-md border border-transparent bg-transparent px-2 font-mono text-sm outline-none focus:ring-[3px]'
        />

        <Divider />

        {viewGroups.map((group, index) => (
          <Fragment key={group[0].value}>
            {index > 0 && <Divider />}
            {group.map((route) => (
              <Button
                key={route.value}
                variant={route.value === currentView ? 'secondary' : 'ghost'}
                size='sm'
                aria-current={route.value === currentView ? 'page' : undefined}
                className={cn(
                  route.value !== currentView && 'text-muted-foreground'
                )}
                onClick={() => navigate(route.path)}
                title={route.label}
              >
                <route.Icon />
                {/* Icons alone on a narrower window, so the row still fits. */}
                <span className='hidden xl:inline'>{route.label}</span>
              </Button>
            ))}
          </Fragment>
        ))}

        <Divider />

        <Button
          variant='ghost'
          size='icon-sm'
          onClick={() => setTheme(nextTheme.value)}
          title={`Theme: ${themeLabel} (click for ${nextTheme.label})`}
          aria-label={`Theme: ${themeLabel}`}
        >
          <ThemeIcon />
        </Button>
        <Button
          variant='ghost'
          size='icon-sm'
          onClick={() => setIsAboutOpen(true)}
          title='About'
          aria-label='About'
        >
          <Info />
        </Button>
      </nav>

      <Dialog
        open={isAboutOpen}
        onOpenChange={setIsAboutOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>About</DialogTitle>
            <DialogDescription>CSR Editor</DialogDescription>
          </DialogHeader>

          <div className='space-y-3 text-sm'>
            <p className='text-muted-foreground'>
              Browser-based CSR editor with JSON import/export and integrated
              RTL generation.
            </p>
            <div>
              <p className='font-medium'>Version</p>
              <p className='text-muted-foreground mt-1'>{packageInfo.version}</p>
            </div>
            <div>
              <p className='font-medium'>Feature</p>
              <div className='text-muted-foreground mt-1 space-y-2'>
                <p>
                  Create and manage CSR designs end to end in the browser.
                </p>
                <ul className='list-disc space-y-1 pl-5'>
                  <li>Edit registers, fields, reset values, and bit ranges</li>
                  <li>
                    Model RW, RO, WO, W1C, W0C, W1P, and W1SC field behaviour
                  </li>
                  <li>Configure module name, data width, address width, and interface</li>
                  <li>Import and export project JSON files</li>
                  <li>Generate native or Avalon-MM RTL</li>
                  <li>Preview generated SystemVerilog in the RTL viewer</li>
                  <li>
                    Mark the quasi-static fields and generate the SDC that cuts
                    their timing
                  </li>
                  <li>Download the active RTL file or all generated outputs</li>
                  <li>Export the register datasheet as PDF</li>
                </ul>
              </div>
            </div>
            <div>
              <p className='font-medium'>Authors</p>
              <ul className='text-muted-foreground mt-1 list-disc space-y-1 pl-5'>
                <li>chipguys2026 (lead author)</li>
                <li>superzeldalink (contributor)</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
