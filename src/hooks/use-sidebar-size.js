import { useEffect, useRef } from 'react'

import { useLayoutStore } from '@/store/layout-store'

/**
 * Binds a resizable sidebar panel to one of the widths in the layout store:
 * dragging writes the width back, and a width that changes underneath it -
 * a document opened while the panel is on screen - is applied to it.
 * Spread the result onto the ResizablePanel.
 */
const useSidebarSize = (key) => {
  const size = useLayoutStore((state) => state[key])
  const setLayout = useLayoutStore((state) => state.setLayout)
  const ref = useRef(null)

  useEffect(() => {
    const panel = ref.current
    // Half a percent is below what a drag can land on: only a real change moves it.
    if (panel && Math.abs(panel.getSize() - size) > 0.5) {
      panel.resize(size)
    }
  }, [size])

  return {
    ref,
    defaultSize: size,
    onResize: (next) => setLayout({ [key]: next }),
  }
}

export default useSidebarSize
