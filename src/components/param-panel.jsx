import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { interfaceOptions, paramsSchema } from '@/schemas/params-schema'

import {
  Field,
  FieldDescription,
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

import { Switch } from '@/components/ui/switch'
import { useParamStore } from '@/store/params-store'

export const ParamPanel = () => {
  const {
    dataWidth,
    addrWidth,
    interface: csrInterface,
    moduleName,
    registeredReadback,
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
      registeredReadback: Boolean(registeredReadback),
    },
  })

  useEffect(() => {
    const currentValues = form.getValues()
    const nextValues = {
      dataWidth,
      addrWidth,
      interface: csrInterface,
      moduleName,
      registeredReadback: Boolean(registeredReadback),
    }

    if (
      currentValues.dataWidth === nextValues.dataWidth &&
      currentValues.addrWidth === nextValues.addrWidth &&
      currentValues.interface === nextValues.interface &&
      currentValues.moduleName === nextValues.moduleName &&
      currentValues.registeredReadback === nextValues.registeredReadback
    ) {
      return
    }

    form.reset(nextValues)
  }, [form, dataWidth, addrWidth, csrInterface, moduleName, registeredReadback])

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
      parsed.data.moduleName === moduleName &&
      parsed.data.registeredReadback === Boolean(registeredReadback)
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

        {/* Registered readback */}
        <Controller
          name='registeredReadback'
          control={form.control}
          render={({ field }) => (
            <Field>
              <div className='flex items-center gap-2'>
                <Switch
                  id='registeredReadback'
                  checked={Boolean(field.value)}
                  onCheckedChange={(checked) =>
                    commitParamChange('registeredReadback', checked)
                  }
                />
                <FieldLabel htmlFor='registeredReadback'>
                  Registered readback
                </FieldLabel>
              </div>
              <FieldDescription>
                Registers the readback mux output. Adds one cycle of read
                latency, absorbed by the bridge.
              </FieldDescription>
            </Field>
          )}
        />
      </FieldGroup>
    </div>
  )
}
