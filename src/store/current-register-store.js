import { create } from 'zustand'

export const useCurrentRegisterStore = create((set) => ({
  currentRegister: null, // addr | null

  setCurrentRegister: (addr) => set({ currentRegister: addr }),

  clearCurrentRegister: () => set({ currentRegister: null }),
}))
