import { z } from 'zod'

const isPowerOfTwo = (value) => (value & (value - 1)) === 0
export const interfaceOptions = ['Native', 'AvalonMM']
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Parameter names the generator always emits itself. */
export const reservedParameterNames = ['ADDR_WIDTH', 'DATA_WIDTH']

/** A user-declared RTL parameter, emitted as `parameter NAME = value`. */
export const parameterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Parameter name is required')
    .regex(identifierPattern, 'Use letters, numbers, and underscores only')
    .refine(
      (name) => !reservedParameterNames.includes(name.toUpperCase()),
      'ADDR_WIDTH and DATA_WIDTH are reserved'
    ),
  value: z.number().int('Value must be an integer'),
  description: z.string().default(''),
})

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
    .regex(identifierPattern, 'Use letters, numbers, and underscores only')
    .default('CSR'),

  parameters: z
    .array(parameterSchema)
    .superRefine((parameters, ctx) => {
      const seen = new Set()

      parameters.forEach((parameter, index) => {
        if (seen.has(parameter.name)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate parameter '${parameter.name}'`,
            path: [index, 'name'],
          })
        }
        seen.add(parameter.name)
      })
    })
    .default([]),
})

export const createParameter = (parameters = []) => {
  const taken = new Set(parameters.map((parameter) => parameter.name))
  let name = 'NUM_LANES'
  let suffix = 1

  while (taken.has(name)) {
    suffix += 1
    name = `NUM_LANES_${suffix}`
  }

  return { name, value: 1, description: '' }
}
