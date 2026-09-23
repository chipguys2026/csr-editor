import { create } from 'zustand'

/** Sidebar width, as a percentage of the frame, when a document names none. */
export const DEFAULT_SIDEBAR_SIZE = 20

/**
 * How wide the sidebars are, saved with the document rather than the browser
 * so a map opens laid out the way it was left. The output views share one
 * width, so switching between them does not move where the content starts;
 * the editor, which holds forms rather than a list, keeps its own.
 */
export const useLayoutStore = create((set) => ({
  viewSidebar: DEFAULT_SIDEBAR_SIZE,
  editorSidebar: DEFAULT_SIDEBAR_SIZE,

  setLayout: (layout) => set(layout),
}))

/** The layout as a document stores it, anything missing or out of range dropped. */
export const parseLayout = (layout) =>
  Object.fromEntries(
    ['viewSidebar', 'editorSidebar']
      .map((key) => [key, Number(layout?.[key])])
      .filter(([, size]) => Number.isFinite(size) && size > 0 && size < 100)
  )
