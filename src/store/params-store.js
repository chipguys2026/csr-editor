import { create } from 'zustand'

export const useParamStore = create((set) => ({
  dataWidth: 32,
  addrWidth: 16,

  setParams: (params) => set(params),
}))
