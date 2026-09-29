import { create } from 'zustand'

export const useParamStore = create((set) => ({
  dataWidth: 32,
  addrWidth: 16,
  interface: 'Native',
  moduleName: 'CSR',
  parameters: [],
  headerPrefix: '',
  registeredReadback: false,
  sdcTarget: 'synopsys',

  setParams: (params) => set(params),
}))
