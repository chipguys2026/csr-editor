import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import useSidebarSize from '@/hooks/use-sidebar-size'
import { codeColors } from '@/lib/code-colors'
import { cn } from '@/lib/utils'

/**
 * The frame every output view is drawn in, taken from the RTL view: a card
 * with a sidebar listing what can be shown, a title bar with the actions for
 * it, and the content below. One component so the views cannot drift apart.
 */

/** One entry of the sidebar list: a link when given an href, else a button. */
export const SidebarItem = ({
  active,
  href,
  onClick,
  className,
  children,
  ...props
}) => {
  const Comp = href ? 'a' : 'button'

  return (
    <Comp
      href={href}
      type={href ? undefined : 'button'}
      onClick={onClick}
      className={cn(
        'flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
        className
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}

export const ViewShell = ({
  layoutKey,
  error,
  sidebarTitle,
  sidebarSubtitle,
  sidebar,
  sidebarRef,
  title,
  subtitle,
  actions,
  children,
}) => {
  const sidebarSize = useSidebarSize(layoutKey)

  return (
    <div className='flex flex-1 flex-col gap-4 overflow-auto p-4'>
      {error ? (
        <div className='rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300'>
          {error}
        </div>
      ) : (
        <section className='bg-card flex min-h-0 flex-1 overflow-hidden rounded-lg border'>
          {/* Each view keeps its own sidebar width, saved with the document. */}
          <ResizablePanelGroup direction='horizontal'>
            <ResizablePanel
              {...sidebarSize}
              minSize={12}
              maxSize={45}
            >
              <aside className='flex h-full flex-col'>
                {/* Fixed at the title bar's height, so the two lines under
                  them meet across the resize handle. */}
                <div className='flex h-16 shrink-0 flex-col justify-center border-b px-4'>
                  <p className='truncate text-sm font-medium'>{sidebarTitle}</p>
                  <p className='text-muted-foreground truncate text-xs'>
                    {sidebarSubtitle}
                  </p>
                </div>

                <div
                  ref={sidebarRef}
                  className='flex-1 overflow-auto p-2'
                >
                  {sidebar}
                </div>
              </aside>
            </ResizablePanel>

            <ResizableHandle />

            <ResizablePanel defaultSize={100 - sidebarSize.defaultSize}>
              <div className='flex h-full min-w-0 flex-col'>
                <div className='flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4'>
                  <div className='min-w-0 flex-1'>
                    <h3 className='truncate font-medium'>{title}</h3>
                    {subtitle && (
                      <p className='text-muted-foreground truncate text-xs'>
                        {subtitle}
                      </p>
                    )}
                  </div>

                  <div className='flex shrink-0 items-center gap-2'>
                    {actions}
                  </div>
                </div>

                {children}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </section>
      )}
    </div>
  )
}

/**
 * A generated file, numbered by line under a column strip, each line coloured
 * by the view's own highlighter.
 */
export const CodeView = ({ label, lines, renderLine, keyPrefix = '' }) => (
  <>
    <div className='bg-muted/30 text-muted-foreground grid grid-cols-[56px_1fr] border-b px-4 py-2 text-xs font-medium tracking-wide uppercase'>
      <div>Line</div>
      <div>{label}</div>
    </div>

    <div className='min-h-0 flex-1 overflow-auto'>
      <div className='font-mono text-xs leading-6'>
        {lines.map((line, index) => (
          <div
            key={`${keyPrefix}-${index}`}
            className='hover:bg-muted/20 grid grid-cols-[56px_1fr] px-4'
          >
            <div className='text-muted-foreground pr-4 text-right select-none'>
              {index + 1}
            </div>
            <pre
              className={cn(
                'overflow-x-auto break-words whitespace-pre-wrap',
                codeColors.text
              )}
            >
              {renderLine(line || ' ', index)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  </>
)
