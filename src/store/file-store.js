import { create } from 'zustand'

/**
 * The file on disk the document is linked to, when the browser allows one.
 * `savedKey` is the content last read from or written to it: autosave writes
 * only when the document has moved away from that.
 *
 * status: 'idle' (no file), 'saved', 'pending' (changed, waiting to write),
 * 'saving', 'error'.
 */
export const useFileStore = create((set) => ({
  handle: null,
  savedKey: null,
  status: 'idle',
  error: null,

  link: (handle, savedKey) =>
    set({ handle, savedKey, status: 'saved', error: null }),
  unlink: () =>
    set({ handle: null, savedKey: null, status: 'idle', error: null }),
  setStatus: (status, error = null) => set({ status, error }),
  markSaved: (savedKey) => set({ savedKey, status: 'saved', error: null }),
}))
