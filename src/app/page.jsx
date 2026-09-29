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
              className='flex h-full w-full flex-col'
              defaultValue='param-panel'
            >
              <AccordionItem
                value='param-panel'
                className='shrink-0'
              >
                <AccordionTrigger className='px-4 py-3 text-sm font-medium hover:no-underline'>
                  Parameters
                </AccordionTrigger>
                <AccordionContent className='flex flex-col gap-4 p-4'>
                  <ParamPanel />
                </AccordionContent>
              </AccordionItem>

              {/* Open, the map takes the rest of the sidebar's height, down to
                the bottom of the window, and its list scrolls within it. */}
              <AccordionItem
                value='register-map'
                className='flex shrink-0 flex-col data-[state=open]:min-h-0 data-[state=open]:flex-1 data-[state=open]:[&>[data-slot=accordion-content]]:flex data-[state=open]:[&>[data-slot=accordion-content]]:min-h-0 data-[state=open]:[&>[data-slot=accordion-content]]:flex-1 data-[state=open]:[&>[data-slot=accordion-content]]:flex-col'
              >
                <AccordionTrigger className='px-4 py-3 text-sm font-medium hover:no-underline'>
                  Register Map
                </AccordionTrigger>
                <AccordionContent className='flex min-h-0 flex-1 flex-col gap-4 p-4'>
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
