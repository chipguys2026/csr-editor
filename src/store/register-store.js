import { create } from 'zustand'

/* ---------------- helpers ---------------- */

/** Name a new register after its address: 0x24 -> REG_0024. */
const addressName = (addr, registers) => {
  const base = `REG_${addr.toString(16).toUpperCase().padStart(4, '0')}`
  const taken = new Set(Object.values(registers).map((reg) => reg.name))

  let name = base
  for (let suffix = 2; taken.has(name); suffix += 1) {
    name = `${base}_${suffix}`
  }

  return name
}

const createEmptyRegister = (addr, registers) => ({
  name: addressName(addr, registers),
  description: '',
  fields: [],
})

const overlap = (a, b) => !(a.msb < b.lsb || b.msb < a.lsb)

/* ---------------- store ---------------- */

export const useRegisterStore = create((set, get) => ({
  // { [addr: number]: register }
  registers: {},

  setRegisters: (registers) => set({ registers: registers ?? {} }),

  /* ---------- register level ---------- */

  createRegister: (addr) =>
    set((state) => {
      if (state.registers[addr]) return state

      return {
        registers: {
          ...state.registers,
          [addr]: createEmptyRegister(addr, state.registers),
        },
      }
    }),

  removeRegister: (addr) =>
    set((state) => {
      if (!state.registers[addr]) return state

      const registers = { ...state.registers }
      delete registers[addr]

      return { registers }
    }),

  /** Place a register at an address, creating or replacing it (used by undo). */
  setRegister: (addr, register) =>
    set((state) => ({
      registers: {
        ...state.registers,
        [addr]: register,
      },
    })),

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
