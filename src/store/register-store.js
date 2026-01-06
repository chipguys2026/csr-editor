import { create } from 'zustand'

/* ---------------- helpers ---------------- */

const randomName = () =>
  `REG_${Math.random().toString(16).slice(2, 8).toUpperCase()}`

const createEmptyRegister = () => ({
  name: randomName(),
  description: '',
  fields: [],
})

const overlap = (a, b) => !(a.msb < b.lsb || b.msb < a.lsb)

/* ---------------- store ---------------- */

export const useRegisterStore = create((set, get) => ({
  // { [addr: number]: register }
  registers: {},

  /* ---------- register level ---------- */

  createRegister: (addr) =>
    set((state) => {
      if (state.registers[addr]) return state

      return {
        registers: {
          ...state.registers,
          [addr]: createEmptyRegister(),
        },
      }
    }),

  updateRegister: (addr, newRegister) =>
    set((state) => {
      if (!state.registers[addr]) return state

      return {
        registers: {
          ...state.registers,
          [addr]: {
            ...newRegister,
          },
        },
      }
    }),

  patchRegister: (addr, patch) =>
    set((state) => {
      const reg = state.registers[addr]
      if (!reg) return state

      return {
        registers: {
          ...state.registers,
          [addr]: {
            ...reg,
            ...patch,
          },
        },
      }
    }),

  getRegisterByAddr: (addr) => {
    return get().registers[addr] ?? null
  },

  /* ---------- field level ---------- */

  addField: (addr, field) =>
    set((state) => {
      const reg = state.registers[addr]
      if (!reg) return state

      const { bitRange } = field
      if (!bitRange || bitRange.msb < bitRange.lsb) {
        console.warn('Invalid bitRange')
        return state
      }

      for (const f of reg.fields) {
        if (overlap(f.bitRange, bitRange)) {
          console.warn('Bit range overlap')
          return state
        }
      }

      return {
        registers: {
          ...state.registers,
          [addr]: {
            ...reg,
            fields: [...reg.fields, field],
          },
        },
      }
    }),

  updateField: (addr, index, patch) =>
    set((state) => {
      const reg = state.registers[addr]
      if (!reg || !reg.fields[index]) return state

      const updated = {
        ...reg.fields[index],
        ...patch,
      }

      if (updated.bitRange) {
        const { msb, lsb } = updated.bitRange
        if (msb < lsb) {
          console.warn('Invalid bitRange')
          return state
        }

        for (let i = 0; i < reg.fields.length; i++) {
          if (i === index) continue
          if (overlap(reg.fields[i].bitRange, updated.bitRange)) {
            console.warn('Bit range overlap')
            return state
          }
        }
      }

      const fields = [...reg.fields]
      fields[index] = updated

      return {
        registers: {
          ...state.registers,
          [addr]: {
            ...reg,
            fields,
          },
        },
      }
    }),

  removeField: (addr, index) =>
    set((state) => {
      const reg = state.registers[addr]
      if (!reg || !reg.fields[index]) return state

      const fields = reg.fields.filter((_, i) => i !== index)

      return {
        registers: {
          ...state.registers,
          [addr]: {
            ...reg,
            fields,
          },
        },
      }
    }),

  /* ---------- register address move ---------- */

  moveInsert: (srcAddr, dstAddr, step, maxAddr) =>
    set((state) => {
      if (srcAddr === dstAddr) return state
      if (!state.registers[srcAddr]) return state

      const regs = { ...state.registers }
      const moving = regs[srcAddr]
      delete regs[srcAddr]

      let hole = dstAddr
      while (hole <= maxAddr && regs[hole]) {
        hole += step
      }

      for (let addr = hole; addr > dstAddr; addr -= step) {
        regs[addr] = regs[addr - step]
      }

      regs[dstAddr] = moving

      return { registers: regs }
    }),
}))
