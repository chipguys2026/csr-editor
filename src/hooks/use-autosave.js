import { useEffect } from 'react'

import {
  documentKey,
  serializeProject,
  writeToHandle,
} from '@/lib/project-file'
import { useFileStore } from '@/store/file-store'
import { useLayoutStore } from '@/store/layout-store'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'

/** Quiet time after the last change before the file is written. */
const AUTOSAVE_DELAY_MS = 800

/**
 * Writes the document back to its linked file a moment after it stops
 * changing. Mount once, where it lives as long as the app does.
 *
 * Writes are serialised: a change that lands while one is in flight is
 * picked up when it finishes, never raced against it.
 */
const useAutosave = () => {
  useEffect(() => {
    let timer = null
    let writing = false

    const flush = async () => {
      timer = null
      const { handle, savedKey, setStatus, markSaved } = useFileStore.getState()
      if (!handle || writing) return

      const key = documentKey()
      if (key === savedKey) {
        setStatus('saved')
        return
      }

      writing = true
      setStatus('saving')

      try {
        await writeToHandle(handle, serializeProject())
        // Only if the file is still the one this write went to.
        if (useFileStore.getState().handle === handle) markSaved(key)
      } catch (error) {
        console.error(error)
        setStatus('error', error?.message ?? 'Could not write the file')
      } finally {
        writing = false
      }

      // Something changed while writing: go round again.
      if (useFileStore.getState().handle === handle && documentKey() !== key) {
        schedule()
      }
    }

    const schedule = () => {
      const { handle, savedKey, status, setStatus } = useFileStore.getState()
      if (!handle) return

      if (documentKey() === savedKey) {
        if (status === 'pending') setStatus('saved')
        return
      }

      if (status !== 'saving') setStatus('pending')
      clearTimeout(timer)
      timer = setTimeout(flush, AUTOSAVE_DELAY_MS)
    }

    const unsubscribers = [
      useParamStore.subscribe(schedule),
      useRegisterStore.subscribe(schedule),
      useLayoutStore.subscribe(schedule),
    ]

    return () => {
      clearTimeout(timer)
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [])
}

export default useAutosave
