import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { paramsSchema } from '@/schemas/params-schema'

import { Button } from '@/components/ui/button'
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'

import { useParamStore } from '@/store/params-store'

export const ParamPanel = () => {
  const { dataWidth, addrWidth, setParams } = useParamStore()

  const form = useForm({
    resolver: zodResolver(paramsSchema),
    defaultValues: {
      dataWidth: dataWidth || 32,
      addrWidth: addrWidth || 16,
    },
  })

  const { isDirty } = form.formState

  function handleDismiss() {
    form.reset({
      dataWidth,
      addrWidth,
    })
  }

  function onSubmit(values) {
    setParams(values)
    form.reset(values) // reset dirty
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
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
                onChange={(e) => field.onChange(Number(e.target.value))}
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
                onChange={(e) => field.onChange(Number(e.target.value))}
              />

              {fieldState.error && (
                <FieldError errors={[{ message: fieldState.error.message }]} />
              )}
            </Field>
          )}
        />

        {/* Buttons */}
        <div className='mt-4 flex gap-2'>
          <Button
            type='submit'
            disabled={!isDirty}
          >
            Create
          </Button>

          <Button
            type='button'
            variant='secondary'
            disabled={!isDirty}
            onClick={handleDismiss}
          >
            Dismiss
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
