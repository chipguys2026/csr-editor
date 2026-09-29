import { Fragment, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import useTheme from '@/hooks/use-theme'
import useAutosave from '@/hooks/use-autosave'

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
import {
  applyProject,
  canLinkFiles,
  documentKey,
  downloadProject,
  pickFileToOpen,
  pickFileToSave,
  requestWriteAccess,
  serializeProject,
  writeToHandle,
} from '@/lib/project-file'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { useCurrentRegisterStore } from '@/store/current-register-store'
import { useFileStore } from '@/store/file-store'
import { toast } from 'sonner'

/** Theme button: each press moves to the next, and shows where it is now. */
const THEMES = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: SunMoon },
]

/** A thin upright rule between toolbar groups. */
const Divider = () => <div className='bg-border mx-1 h-5 w-px shrink-0' />

/** What the status beside the file name says, and how. */
const SAVE_STATUS = {
  pending: { label: 'Edited', className: 'text-muted-foreground' },
  saving: { label: 'Saving…', className: 'text-muted-foreground' },
  saved: { label: 'Saved', className: 'text-muted-foreground' },
  error: { label: 'Save failed', className: 'text-red-600 dark:text-red-400' },
}

/** A file name as Save writes it: always ending in .json. */
const asJsonName = (name) => (/\.json$/i.test(name) ? name : `${name}.json`)

export const NavBar = () => {
  const { theme, setTheme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const moduleName = useParamStore((state) => state.moduleName)
  const setParams = useParamStore((state) => state.setParams)
  const setRegisters = useRegisterStore((state) => state.setRegisters)
  const setCurrentRegister = useCurrentRegisterStore(
    (state) => state.setCurrentRegister
  )
  const fileInputRef = useRef(null)
  const { handle, status, error: saveError, link, unlink } = useFileStore()
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  // The file the document came from, and is saved back as. Left empty it
  // falls back to the module name, which is what a new document is saved as.
  const [fileName, setFileName] = useState('')

  useAutosave()
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
    // A new document is not the file that was open: stop writing to it.
    unlink()
    navigate('/')
    toast.success('Created a new CSR document')
  }

  // Save writes to the linked file when the name still matches it. A new name,
  // or no file yet, asks where to save - and links the document to it, so
  // autosave takes over from there. Without file access it downloads a copy.
  const onSaveJson = async () => {
    const name = asJsonName(fileName.trim() || `${moduleName}.json`)

    try {
      if (handle && handle.name === name) {
        useFileStore.getState().setStatus('saving')
        await writeToHandle(handle, serializeProject())
        useFileStore.getState().markSaved(documentKey())
        toast.success(`Saved ${name}`)
        return
      }

      if (!canLinkFiles) {
        downloadProject(name, serializeProject())
        return
      }

      const next = await pickFileToSave(name)
      if (!next) return

      await writeToHandle(next, serializeProject())
      link(next, documentKey())
      setFileName(next.name)
      toast.success(`Saved ${next.name} - changes now save to it`)
    } catch (error) {
      console.error(error)
      useFileStore.getState().setStatus('error', error?.message)
      toast.error('Failed to save JSON')
    }
  }

  const onOpenJson = async () => {
    if (!canLinkFiles) {
      fileInputRef.current?.click()
      return
    }

    try {
      const next = await pickFileToOpen()
      if (!next) return

      // Asked straight after the pick, while the click still counts: the
      // browser will not ask later, from an autosave.
      const writable = await requestWriteAccess(next)

      applyProject(await (await next.getFile()).text())
      setFileName(next.name)

      if (writable) {
        link(next, documentKey())
      } else {
        unlink()
        toast.warning(`Opened ${next.name} read-only: changes will not save to it`)
      }
    } catch (error) {
      console.error(error)
      toast.error('Failed to open JSON')
    }
  }

  // Browsers without file access: the plain upload, nothing to write back to.
  const onFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      applyProject(await file.text())
      setFileName(file.name)
      unlink()
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

        {/* Where the document stands against its file. Unlinked, it says why
            nothing is being written, rather than saying nothing. */}
        {handle ? (
          <span
            className={cn(
              'shrink-0 text-xs whitespace-nowrap',
              (SAVE_STATUS[status] ?? SAVE_STATUS.saved).className
            )}
            title={
              status === 'error'
                ? `Could not write ${handle.name}: ${saveError}`
                : `Changes save to ${handle.name} automatically`
            }
          >
            {(SAVE_STATUS[status] ?? SAVE_STATUS.saved).label}
          </span>
        ) : (
          <span
            className='text-muted-foreground shrink-0 text-xs whitespace-nowrap'
            title={
              canLinkFiles
                ? 'Open or save a file to have changes save to it automatically'
                : 'This browser cannot write back to a file: Save downloads a copy'
            }
          >
            {canLinkFiles ? 'Autosave off' : 'No autosave'}
          </span>
        )}

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
              <p className='font-medium'>License</p>
              <p className='text-muted-foreground mt-1'>
                AGPL-3.0-only or a separate commercial license
              </p>
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
              <p className='font-medium'>Project credits</p>
              <ul className='text-muted-foreground mt-1 list-disc space-y-1 pl-5'>
                <li>chipguys2026 / khiemnb153 (owner and original contributor)</li>
                <li>superzeldalink (contributor)</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
