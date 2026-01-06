import { z } from 'zod'

const isPowerOfTwo = (value) => (value & (value - 1)) === 0

export const paramsSchema = z.object({
  dataWidth: z
    .number()
    .int()
    .positive()
    .default(32)
    .refine(isPowerOfTwo, 'Must be a power of 2'),

  addrWidth: z.number().int().positive().default(16),
})
