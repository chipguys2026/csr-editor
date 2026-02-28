import { useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import useTheme from '@/hooks/use-theme'

import { Sun, Moon, SunMoon } from 'lucide-react'

import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@/components/ui/menubar'

import packageInfo from '../../package.json'
import { paramsSchema } from '@/schemas/params-schema'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { useCurrentRegisterStore } from '@/store/current-register-store'
import { toast } from 'sonner'

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
  const { dataWidth, addrWidth, interface: csrInterface, moduleName } =
    useParamStore()
  const registers = useRegisterStore((state) => state.registers)
  const setParams = useParamStore((state) => state.setParams)
  const setRegisters = useRegisterStore((state) => state.setRegisters)
  const setCurrentRegister = useCurrentRegisterStore(
    (state) => state.setCurrentRegister
  )
  const fileInputRef = useRef(null)
  const viewRoutes = [
    { label: 'Editor', value: 'editor', path: '/' },
    { label: 'Document', value: 'document', path: '/document' },
    { label: 'RTL', value: 'rtl', path: '/rtl' },
    { label: 'SDC', value: 'sdc', path: '/sdc' },
  ]
  const currentView =
    viewRoutes.find((route) => route.path === location.pathname)?.value ??
    'editor'

  const onNewJson = () => {
    setParams(paramsSchema.parse({}))
    setRegisters({})
    setCurrentRegister(null)
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
      },
      registers,
    }

    downloadJson(`${moduleName}.json`, payload)
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

      const nextParams = paramsSchema.parse({
        dataWidth: Number(params.dataWidth),
        addrWidth: Number(params.addrWidth),
        interface: params.interface ?? 'Native',
        moduleName: params.moduleName ?? 'CSR',
      })

      setParams(nextParams)
      setRegisters(importedRegisters)

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

  return (
    <nav className='flex flex-row items-center gap-4 border-b p-2'>
      <h1 className='font-bold'>CSR Editor</h1>
      <input
        ref={fileInputRef}
        type='file'
        accept='application/json,.json'
        className='hidden'
        onChange={onFileChange}
      />

      <Menubar className='border-0'>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onNewJson}>New</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={onOpenJson}>Open JSON</MenubarItem>
            <MenubarItem onClick={onSaveJson}>Save JSON</MenubarItem>
            <MenubarSeparator />
            <MenubarItem>Export PDF</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarRadioGroup
              value={currentView}
              onValueChange={(value) => {
                const next = viewRoutes.find((route) => route.value === value)
                if (next) navigate(next.path)
              }}
            >
              {viewRoutes.map((route) => (
                <MenubarRadioItem
                  key={route.value}
                  value={route.value}
                >
                  {route.label}
                </MenubarRadioItem>
              ))}
            </MenubarRadioGroup>
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger>Theme</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarRadioGroup
                  value={theme}
                  onValueChange={(value) => setTheme(value)}
                >
                  <MenubarRadioItem value='light'>
                    <Sun className='h-4 w-4' />
                    Light
                  </MenubarRadioItem>
                  <MenubarRadioItem value='dark'>
                    <Moon className='h-4 w-4' />
                    Dark
                  </MenubarRadioItem>
                  <MenubarRadioItem value='system'>
                    <SunMoon className='h-4 w-4' />
                    System
                  </MenubarRadioItem>
                </MenubarRadioGroup>
              </MenubarSubContent>
            </MenubarSub>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>Help</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>About</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </nav>
  )
}
