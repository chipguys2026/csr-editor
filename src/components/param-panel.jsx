import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { interfaceOptions, paramsSchema } from '@/schemas/params-schema'

import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { useParamStore } from '@/store/params-store'

export const ParamPanel = () => {
  const {
    dataWidth,
    addrWidth,
    interface: csrInterface,
    moduleName,
    setParams,
  } = useParamStore()

  const form = useForm({
    resolver: zodResolver(paramsSchema),
    mode: 'onChange',
    defaultValues: {
      dataWidth: dataWidth || 32,
      addrWidth: addrWidth || 16,
      interface: csrInterface || 'Native',
      moduleName: moduleName || 'CSR',
    },
  })

  useEffect(() => {
    const currentValues = form.getValues()
    const nextValues = {
      dataWidth,
      addrWidth,
      interface: csrInterface,
      moduleName,
    }

    if (
      currentValues.dataWidth === nextValues.dataWidth &&
      currentValues.addrWidth === nextValues.addrWidth &&
      currentValues.interface === nextValues.interface &&
      currentValues.moduleName === nextValues.moduleName
    ) {
      return
    }

    form.reset(nextValues)
  }, [form, dataWidth, addrWidth, csrInterface, moduleName])

  const commitParamChange = (name, value) => {
    form.setValue(name, value, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })

    const nextValues = {
      ...form.getValues(),
      [name]: value,
    }
    const parsed = paramsSchema.safeParse(nextValues)

    if (!parsed.success) return

    if (
      parsed.data.dataWidth === dataWidth &&
      parsed.data.addrWidth === addrWidth &&
      parsed.data.interface === csrInterface &&
      parsed.data.moduleName === moduleName
    ) {
      return
    }

    setParams(parsed.data)
  }

  return (
    <div>
      <FieldGroup>
        {/* AddrWidth */}
        <Controller
          name='addrWidth'
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor='addrWidth'>Address Width</FieldLabel>

              <Input
                id='addrWidth'
                {...field}
                value={field.value ?? ''}
                onChange={(e) => commitParamChange('addrWidth', Number(e.target.value))}
              />

              {fieldState.error && (
                <FieldError errors={[{ message: fieldState.error.message }]} />
              )}
            </Field>
          )}
        />

        {/* DataWidth */}
        <Controller
          name='dataWidth'
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor='dataWidth'>Data Width</FieldLabel>

              <Input
                id='dataWidth'
                {...field}
                value={field.value ?? ''}
                onChange={(e) => commitParamChange('dataWidth', Number(e.target.value))}
              />

              {fieldState.error && (
                <FieldError errors={[{ message: fieldState.error.message }]} />
              )}
            </Field>
          )}
        />

        {/* Module Name */}
        <Controller
          name='moduleName'
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor='moduleName'>Module Name</FieldLabel>

              <Input
                id='moduleName'
                {...field}
                value={field.value ?? ''}
                onChange={(e) => commitParamChange('moduleName', e.target.value)}
              />

              {fieldState.error && (
                <FieldError errors={[{ message: fieldState.error.message }]} />
              )}
            </Field>
          )}
        />

        {/* Interface */}
        <Controller
          name='interface'
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor='interface'>Interface</FieldLabel>

              <Select
                value={field.value}
                onValueChange={(value) => commitParamChange('interface', value)}
              >
                <SelectTrigger
                  id='interface'
                  className='w-full'
                >
                  <SelectValue placeholder='Select interface' />
                </SelectTrigger>

                <SelectContent>
                  {interfaceOptions.map((option) => (
                    <SelectItem
                      key={option}
                      value={option}
                    >
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {fieldState.error && (
                <FieldError errors={[{ message: fieldState.error.message }]} />
              )}
            </Field>
          )}
        />
      </FieldGroup>
    </div>
  )
}
