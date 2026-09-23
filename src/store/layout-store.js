import { create } from 'zustand'

/** Sidebar width, as a percentage of the frame, when a document names none. */
export const DEFAULT_SIDEBAR_SIZE = 20

/**
 * The sidebars whose width is kept: the editor's and each output view's, one
 * apiece, since each lists something different and wants its own width.
 */
export const SIDEBAR_KEYS = [
  'editorSidebar',
  'rtlSidebar',
  'sdcSidebar',
  'headerSidebar',
  'excelSidebar',
  'documentSidebar',
]

/**
 * How wide the sidebars are, saved with the document rather than the browser
 * so a map opens laid out the way it was left.
 */
export const useLayoutStore = create((set) => ({
  ...Object.fromEntries(SIDEBAR_KEYS.map((key) => [key, DEFAULT_SIDEBAR_SIZE])),

  setLayout: (layout) => set(layout),
}))

/** The layout as a document stores it, anything missing or out of range dropped. */
export const parseLayout = (layout) => {
  // A document saved when the views shared one width hands it to each of them.
  const shared = layout?.viewSidebar

  return Object.fromEntries(
    SIDEBAR_KEYS.map((key) => [
      key,
      Number(layout?.[key] ?? (key === 'editorSidebar' ? undefined : shared)),
    ]).filter(([, size]) => Number.isFinite(size) && size > 0 && size < 100)
  )
}
