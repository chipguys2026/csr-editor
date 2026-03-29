import { z } from 'zod'

const isPowerOfTwo = (value) => (value & (value - 1)) === 0
export const interfaceOptions = ['Native', 'AvalonMM']
const moduleNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/

export const paramsSchema = z.object({
  dataWidth: z
    .number()
    .int()
    .positive()
    .default(32)
    .refine(isPowerOfTwo, 'Must be a power of 2'),

  addrWidth: z.number().int().positive().default(16),
  interface: z.enum(interfaceOptions).default('Native'),
  moduleName: z
    .string()
    .trim()
    .min(1, 'Module name is required')
    .regex(moduleNamePattern, 'Use letters, numbers, and underscores only')
    .default('CSR'),
})
