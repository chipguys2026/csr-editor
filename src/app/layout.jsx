import { Toaster } from '@/components/ui/sonner'
import ThemeProvider from '@/components/theme-provider'
import { NavBar } from '@/components/nav-bar'

const RootLayout = ({ children }) => {
  return (
    <div className='font-plus-jakarta-sans h-screen w-screen overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] antialiased'>
      <ThemeProvider>
        <Toaster
          position='top-right'
          expand={true}
        />
        <main className='flex h-full w-full flex-col'>
          <NavBar />
          {children}
        </main>
      </ThemeProvider>
    </div>
  )
}

export default RootLayout
