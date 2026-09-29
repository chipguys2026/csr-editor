import { toast } from 'sonner'

import { useRegisterStore } from '@/store/register-store'
import { useCurrentRegisterStore } from '@/store/current-register-store'

/**
 * Delete a register and offer an undo toast instead of a confirm dialog, so
 * the common case stays one click and a misclick is still recoverable.
 */
export const deleteRegister = (addr) => {
  const removed = useRegisterStore.getState().registers[addr]
  if (!removed) return

  useRegisterStore.getState().removeRegister(addr)

  if (useCurrentRegisterStore.getState().currentRegister === addr) {
    useCurrentRegisterStore.getState().clearCurrentRegister()
  }

  toast.success(`Deleted ${removed.name}`, {
    action: {
      label: 'Undo',
      onClick: () => {
        useRegisterStore.getState().setRegister(addr, removed)
        useCurrentRegisterStore.getState().setCurrentRegister(addr)
      },
    },
  })
}
