import { create } from 'zustand'

export const useParamStore = create((set) => ({
  dataWidth: 32,
  addrWidth: 16,
  interface: 'Native',
  moduleName: 'CSR',
  parameters: [],

  setParams: (params) => set(params),
}))
