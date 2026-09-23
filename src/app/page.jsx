import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

import { ParamPanel } from '@/components/param-panel'
import { RegisterMap } from '@/components/register-map'
import { RegisterDetail } from '@/components/register-detail'

import { useCurrentRegisterStore } from '@/store/current-register-store'
import useSidebarSize from '@/hooks/use-sidebar-size'
import { BadgeAlert } from 'lucide-react'

const HomePage = () => {
  const currentRegister = useCurrentRegisterStore((s) => s.currentRegister)
  const sidebarSize = useSidebarSize('editorSidebar')

  // The same frame as the output views: a card inset from the window, the
  // sidebar headings set as their sidebar title is.
  return (
    <div className='flex flex-1 flex-col gap-4 overflow-auto p-4'>
      <section className='bg-card flex min-h-0 flex-1 overflow-hidden rounded-lg border'>
        <ResizablePanelGroup direction='horizontal'>
          {/* The panel clips by default; the sidebar is taller than the window
            once Parameters is open, so it scrolls instead. */}
          <ResizablePanel
            {...sidebarSize}
            className='overflow-y-auto!'
          >
            <Accordion
              type='single'
              collapsible
              className='w-full'
              defaultValue='param-panel'
            >
              <AccordionItem value='param-panel'>
                <AccordionTrigger className='px-4 py-3 text-sm font-medium hover:no-underline'>
                  Parameters
                </AccordionTrigger>
                <AccordionContent className='flex flex-col gap-4 p-4'>
                  <ParamPanel />
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value='register-map'>
                <AccordionTrigger className='px-4 py-3 text-sm font-medium hover:no-underline'>
                  Register Map
                </AccordionTrigger>
                <AccordionContent className='flex flex-col gap-4 p-4'>
                  <RegisterMap />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel defaultSize={100 - sidebarSize.defaultSize}>
            {currentRegister == null ? (
              <div className='flex h-full w-full items-center justify-center'>
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <BadgeAlert />
                    </EmptyMedia>
                    <EmptyTitle>No Register Selected</EmptyTitle>
                    <EmptyDescription>
                      Select a register from the Register Map to view and edit
                      it in detail, or hover a reserved address and press + to
                      create one there.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent />
                </Empty>
              </div>
            ) : (
              <RegisterDetail />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </section>
    </div>
  )
}

export default HomePage
