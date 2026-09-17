import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { Plus, Trash2 } from 'lucide-react'
import {
  createParameter,
  interfaceOptions,
  paramsSchema,
} from '@/schemas/params-schema'

import { Button } from '@/components/ui/button'

import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldError,
  FieldGroup,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { Switch } from '@/components/ui/switch'
import { useParamStore } from '@/store/params-store'

const sameParams = (a, b) =>
  a.dataWidth === b.dataWidth &&
  a.addrWidth === b.addrWidth &&
  a.interface === b.interface &&
  a.moduleName === b.moduleName &&
  Boolean(a.registeredReadback) === Boolean(b.registeredReadback) &&
  JSON.stringify(a.parameters ?? []) === JSON.stringify(b.parameters ?? [])

export const ParamPanel = () => {
  const {
    dataWidth,
    addrWidth,
    interface: csrInterface,
    moduleName,
    parameters,
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
      parameters: parameters ?? [],
      registeredReadback: Boolean(registeredReadback),
    },
  })

  useEffect(() => {
    const nextValues = {
      dataWidth,
      addrWidth,
      interface: csrInterface,
      moduleName,
      parameters: parameters ?? [],
      registeredReadback: Boolean(registeredReadback),
    }

    if (sameParams(form.getValues(), nextValues)) {
      return
    }

    form.reset(nextValues)
  }, [
    form,
    dataWidth,
    addrWidth,
    csrInterface,
    moduleName,
    parameters,
    registeredReadback,
  ])

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
      sameParams(parsed.data, {
        dataWidth,
        addrWidth,
        interface: csrInterface,
        moduleName,
        parameters,
        registeredReadback,
      })
    ) {
      return
    }

    setParams(parsed.data)
  }

  const declaredParameters = form.watch('parameters') ?? []

  const patchParameter = (index, patch) =>
    commitParamChange(
      'parameters',
      declaredParameters.map((parameter, i) =>
        i === index ? { ...parameter, ...patch } : parameter
      )
    )

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

        {/* RTL parameters */}
        <Field>
          <div className='flex items-center justify-between'>
            <FieldLabel>RTL Parameters</FieldLabel>

            <Button
              type='button'
              variant='outline'
              size='icon'
              className='h-6 w-6'
              title='Add parameter'
              onClick={() =>
                commitParamChange('parameters', [
                  ...declaredParameters,
                  createParameter(declaredParameters),
                ])
              }
            >
              <Plus className='h-3 w-3' />
            </Button>
          </div>

          {declaredParameters.length === 0 ? (
            <p className='text-muted-foreground text-xs'>
              Declare a parameter to size register arrays, e.g. NUM_LANES.
            </p>
          ) : (
            <div className='flex flex-col gap-2'>
              {declaredParameters.map((parameter, index) => (
                <ParameterRow
                  key={index}
                  parameter={parameter}
                  errors={form.formState.errors.parameters?.[index]}
                  onChange={(patch) => patchParameter(index, patch)}
                  onRemove={() =>
                    commitParamChange(
                      'parameters',
                      declaredParameters.filter((_, i) => i !== index)
                    )
                  }
                />
              ))}
            </div>
          )}
        </Field>

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

const ParameterRow = ({ parameter, errors, onChange, onRemove }) => {
  const messages = Object.values(errors ?? {})
    .map((error) => error?.message)
    .filter(Boolean)

  return (
    <div className='flex flex-col gap-1 rounded-md border p-2'>
      <div className='flex items-center gap-1'>
        <Input
          className='h-7 px-2 font-mono text-xs'
          placeholder='NAME'
          value={parameter.name ?? ''}
          onChange={(event) => onChange({ name: event.target.value })}
        />

        <Input
          title='Value'
          placeholder='value'
          className='h-7 w-20 shrink-0 px-2 text-xs'
          value={parameter.value ?? ''}
          onChange={(event) => onChange({ value: Number(event.target.value) })}
        />

        <Button
          type='button'
          variant='outline'
          size='icon'
          className='h-7 w-7 shrink-0'
          title='Remove parameter'
          onClick={onRemove}
        >
          <Trash2 className='text-destructive h-3 w-3' />
        </Button>
      </div>

      {/* text-wrap keeps the description filling its width even if an ancestor
          turns on text-balance, which lays inputs out as even ragged lines. */}
      <textarea
        rows={3}
        placeholder='description'
        value={parameter.description ?? ''}
        onChange={(event) => onChange({ description: event.target.value })}
        className={cn(
          'border-input w-full resize-y rounded-md border bg-transparent px-2 py-1 text-xs text-wrap',
          'focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]'
        )}
      />

      {messages.length > 0 && (
        <FieldError errors={messages.map((message) => ({ message }))} />
      )}
    </div>
  )
}
