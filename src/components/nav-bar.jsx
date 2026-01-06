import useTheme from '@/hooks/use-theme'

import { Sun, Moon, SunMoon } from 'lucide-react'

import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@/components/ui/menubar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const NavBar = () => {
  const { theme, setTheme } = useTheme()

  return (
    <nav className='flex flex-row items-center gap-4 border-b p-2'>
      <h1 className='font-bold'>CSR Editor</h1>
      <Menubar className='border-0'>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>
              New Tab <MenubarShortcut>⌘T</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>New Window</MenubarItem>
            <MenubarSeparator />
            <MenubarItem>Share</MenubarItem>
            <MenubarSeparator />
            <MenubarItem>Print</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      <Select
        onValueChange={(value) => setTheme(value)}
        value={theme}
        className='w-fit'
      >
        <SelectTrigger
          id='themeSelect'
          className='w-fit'
        >
          <SelectValue placeholder='Chọn chủ đề' />
        </SelectTrigger>
        <SelectContent position='popper'>
          <SelectItem value='light'>
            <span className='flex flex-row items-center gap-1'>
              <Sun
                width={16}
                height={16}
              />
              Sáng
            </span>
          </SelectItem>
          <SelectItem value='dark'>
            <span className='flex flex-row items-center gap-1'>
              <Moon
                width={16}
                height={16}
              />
              Tối
            </span>
          </SelectItem>
          <SelectItem value='system'>
            <span className='flex flex-row items-center gap-1'>
              <SunMoon
                width={16}
                height={16}
              />
              Tự động
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </nav>
  )
}
