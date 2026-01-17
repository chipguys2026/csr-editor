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
import { BadgeAlert } from 'lucide-react'

const HomePage = () => {
  const currentRegister = useCurrentRegisterStore((s) => s.currentRegister)

  return (
    <ResizablePanelGroup direction='horizontal'>
      <ResizablePanel defaultSize={20}>
        <Accordion
          type='single'
          collapsible
          className='w-full'
          defaultValue='param-panel'
        >
          <AccordionItem value='param-panel'>
            <AccordionTrigger className='p-4'>Parameters</AccordionTrigger>
            <AccordionContent className='flex flex-col gap-4 p-4 text-balance'>
              <ParamPanel />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value='register-map'>
            <AccordionTrigger className='p-4'>Register Map</AccordionTrigger>
            <AccordionContent className='flex flex-col gap-4 p-4 text-balance'>
              <RegisterMap />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={80}>
        {currentRegister == null ? (
          <div className='flex h-full w-full items-center justify-center'>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <BadgeAlert />
                </EmptyMedia>
                <EmptyTitle>No Register Selected</EmptyTitle>
                <EmptyDescription>
                  Select a Register from Register Map to view and edit in
                  detail.
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
  )
}

export default HomePage
