import { useEffect, useState, useRef, Fragment } from 'react'
import { useForm } from 'react-hook-form'

import { normalizeRegister } from '@/lib/register'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { useCurrentRegisterStore } from '@/store/current-register-store'

import {
  Pencil,
  Plus,
  Save,
  X,
  Trash2,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'

import { RegisterDiagram } from './register-diagram'
import { Badge } from './ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from './ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { hex } from '@/lib/number-formating'

/* ---------------- helpers ---------------- */
const width = (f) => f.bitRange.msb - f.bitRange.lsb + 1

const calcTotalBitsUsed = (fields) =>
  fields.reduce((sum, f) => sum + width(f), 0)

const handleKeyDown = (e) => {
  const row = Number(e.currentTarget.dataset.row)
  const col = e.currentTarget.dataset.col

  if (Number.isNaN(row) || !col) return

  let nextRow = row

  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    nextRow = e.shiftKey ? row - 1 : row + 1
    e.preventDefault()
  } else if (e.key === 'ArrowUp') {
    nextRow = row - 1
    e.preventDefault()
  } else {
    return
  }

  if (nextRow < 0) return

  const next = document.querySelector(
    `[data-row="${nextRow}"][data-col="${col}"]`
  )

  next?.focus()
}

// ----------------------------------------------

const FieldName = ({ field, isEditing, rf, watch }) => {
  return (
    <input
      {...rf(`fields.${field.trueIndex}.name`)}
      disabled={!isEditing}
      size={Math.max(watch(`fields.${field.trueIndex}.name`)?.length || 1, 1)}
      className={cn(
        'w-full border-none bg-transparent p-0',
        'focus:ring-0 focus:outline-none'
      )}
      data-row={field.trueIndex}
      data-col='name'
      onKeyDown={handleKeyDown}
    />
  )
}

const FieldBitRange = ({ field, isEditing, setValue, isOverlap }) => {
  const inputRef = useRef(null)

  const format = (msb, lsb) => (msb === lsb ? `[${msb}]` : `[${msb}:${lsb}]`)

  const [local, setLocal] = useState(
    format(field.bitRange.msb, field.bitRange.lsb)
  )

  // sync khi field đổi (insert / reset)
  useEffect(() => {
    setLocal(format(field.bitRange.msb, field.bitRange.lsb))
  }, [field.bitRange.msb, field.bitRange.lsb])

  if (!isEditing) {
    return <>{format(field.bitRange.msb, field.bitRange.lsb)}</>
  }

  const onBlur = () => {
    const raw = local.trim()

    // ---- strip [] ----
    const stripped = raw.replace(/[\[\]]/g, '')

    let msb, lsb

    // ---- parse ----
    if (stripped.includes(':')) {
      const [m, l] = stripped.split(':').map((v) => Number(v))
      msb = m
      lsb = l
    } else {
      msb = lsb = Number(stripped)
    }

    // ---- validate ----
    const invalid =
      Number.isNaN(msb) ||
      Number.isNaN(lsb) ||
      msb < lsb ||
      msb < 0 ||
      lsb < 0 ||
      (isOverlap && isOverlap(field.trueIndex, msb, lsb))

    if (invalid) {
      // rollback + refocus
      toast.error('Invalie bit range')
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
      return
    }

    // ---- commit ----
    setValue(
      `fields.${field.trueIndex}.bitRange`,
      { msb, lsb },
      { shouldDirty: true }
    )

    // normalize display
    setLocal(format(msb, lsb))
  }

  return (
    <input
      ref={inputRef}
      type='text'
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={onBlur}
      className={cn(
        'w-14 border-none bg-transparent p-0 text-center font-mono',
        'focus:ring-0 focus:outline-none'
      )}
    />
  )
}

const FieldType = ({ field, isEditing, watch, setValue }) => {
  const path = `fields.${field.trueIndex}.type`
  const value = watch(path)

  if (!isEditing) {
    return <Badge variant='outline'>{field.type}</Badge>
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => setValue(path, v, { shouldDirty: true })}
    >
      <SelectTrigger
        data-row={field.trueIndex}
        data-col='type'
        data-size='none'
        className={cn('h-6 gap-0.5 px-1 py-0')}
      >
        <SelectValue />
      </SelectTrigger>

      <SelectContent>
        {['RW', 'RO', 'WO', 'W1C', 'W0C'].map((t) => (
          <SelectItem
            key={t}
            value={t}
          >
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const FieldResetValue = ({ field, isEditing, setValue }) => {
  const inputRef = useRef(null)

  const bitWidth = field.bitRange.msb - field.bitRange.lsb + 1

  const maxValue =
    bitWidth >= 32 ? Number.MAX_SAFE_INTEGER : (1 << bitWidth) - 1

  const [local, setLocal] = useState(
    hex(field.resetValue, field.bitRange.msb - field.bitRange.lsb + 1)
  )

  // sync khi field đổi (reset / insert)
  useEffect(() => {
    setLocal(hex(field.resetValue, field.bitRange.msb - field.bitRange.lsb + 1))
  }, [field.resetValue, field.bitRange])

  if (!isEditing) {
    return (
      <span className='font-mono'>
        {hex(field.resetValue, field.bitRange.msb - field.bitRange.lsb + 1)}
      </span>
    )
  }

  const parseValue = (raw) => {
    const v = raw.trim().toLowerCase()

    if (/^0b[01]+$/.test(v)) {
      return parseInt(v.slice(2), 2)
    }

    if (/^0x[0-9a-f]+$/.test(v)) {
      return parseInt(v.slice(2), 16)
    }

    if (/^\d+$/.test(v)) {
      return Number(v)
    }

    return NaN
  }

  const onBlur = () => {
    const parsed = parseValue(local)

    const invalid = Number.isNaN(parsed) || parsed < 0 || parsed > maxValue

    if (invalid) {
      // rollback + refocus
      toast.error('Invalie reset value')
      // setLocal(format(field.resetValue))
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
      return
    }

    // commit
    setValue(`fields.${field.trueIndex}.resetValue`, parsed, {
      shouldDirty: true,
    })

    // normalize display (decimal)
    setLocal(format(parsed))
  }

  return (
    <input
      ref={inputRef}
      type='text'
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={onBlur}
      className={cn(
        'w-16 border-none bg-transparent p-0 text-right font-mono',
        'focus:ring-0 focus:outline-none'
      )}
    />
  )
}

const FieldDesc = ({ field, isEditing, rf }) => {
  if (!isEditing) {
    return <span className='whitespace-pre-wrap'>{field.desc}</span>
  }

  return (
    <textarea
      {...rf(`fields.${field.trueIndex}.desc`)}
      rows={1}
      data-row={field.trueIndex}
      data-col='desc'
      className={cn(
        'w-full resize-y border-none bg-transparent p-0',
        'focus:ring-0 focus:outline-none'
      )}
    />
  )
}

export const RegisterDetail = () => {
  const { dataWidth } = useParamStore()

  const addr = useCurrentRegisterStore((s) => s.currentRegister)
  const registerData = useRegisterStore((s) =>
    addr != null ? s.registers[addr] : null
  )
  const updateRegister = useRegisterStore((s) => s.updateRegister)

  const [isEditing, setIsEditing] = useState(false)

  const {
    register: rf,
    watch,
    reset,
    handleSubmit,
    setValue,
  } = useForm({
    defaultValues: registerData,
  })

  // sync khi đổi register
  useEffect(() => {
    if (registerData) {
      reset(registerData)
      setIsEditing(false)
    }
  }, [registerData, reset])

  if (!registerData) return null

  const fields = watch('fields')

  const fullFields = normalizeRegister(fields)

  const totalBitsUsed = calcTotalBitsUsed(fields)
  const canInsert = isEditing && totalBitsUsed < dataWidth

  const onSave = handleSubmit((formData) => {
    updateRegister(addr, formData)
    setIsEditing(false)
  })

  const onCancel = () => {
    reset(registerData)
    setIsEditing(false)
  }

  const insertField = (index) => {
    const beforeFields = fields.slice(0, index + 1)
    const afterFields = fields.slice(index + 1)

    const insertPoint = fields[index]?.bitRange.msb + 1 || 0

    const newField = {
      name: 'NEW_FIELD',
      type: 'RW',
      bitRange: {
        msb: insertPoint,
        lsb: insertPoint,
      },
      resetValue: 0,
      desc: '',
    }

    const updatedAfterFields = afterFields.map((field) => ({
      ...field,
      bitRange: {
        msb: field.bitRange.msb + 1,
        lsb: field.bitRange.lsb + 1,
      },
    }))

    setValue('fields', [...beforeFields, newField, ...updatedAfterFields])
  }

  const removeField = (index) => {
    setValue(
      'fields',
      fields.filter((_, i) => i !== index)
    )
  }

  const swapField = (index, direction) => {
    const updatedFields = [...fields]
    let self = updatedFields[index]
    if (!self) return
    self = { ...self, bitRange: { ...self.bitRange } }
    const selfWidth = width(self)

    const otherIndex = direction === 'up' ? index - 1 : index + 1

    let other = updatedFields[otherIndex]
    if (!other) {
      if (direction == 'up' && self.bitRange.lsb > 0) {
        self.bitRange.lsb = 0
        self.bitRange.msb = selfWidth - 1
      } else if (direction == 'down' && self.bitRange.msb < dataWidth - 1) {
        self.bitRange.msb = dataWidth - 1
        self.bitRange.lsb = self.bitRange.msb - selfWidth + 1
      } else if (direction !== 'up' && direction !== 'down') {
        toast.error('Invalid direction')
        return
      }
      updatedFields[index] = self
    } else {
      other = { ...other, bitRange: { ...other.bitRange } }

      const isAdjacent =
        direction == 'up'
          ? self.bitRange.lsb - 1 == other.bitRange.msb
          : self.bitRange.msb + 1 == other.bitRange.lsb

      const otherWidth = width(other)

      if (isAdjacent) {
        if (direction == 'up') {
          self.bitRange.lsb = other.bitRange.lsb
          self.bitRange.msb = self.bitRange.lsb + selfWidth - 1
          other.bitRange.lsb = self.bitRange.msb + 1
          other.bitRange.msb = other.bitRange.lsb + otherWidth - 1
        } else if (direction == 'down') {
          other.bitRange.lsb = self.bitRange.lsb
          other.bitRange.msb = other.bitRange.lsb + otherWidth - 1
          self.bitRange.lsb = other.bitRange.msb + 1
          self.bitRange.msb = self.bitRange.lsb + selfWidth - 1
        } else {
          toast.error('Invalid direction')
          return
        }
        updatedFields[index] = other
        updatedFields[otherIndex] = self
      } else {
        if (direction == 'up') {
          self.bitRange.lsb = other.bitRange.msb + 1
          self.bitRange.msb = self.bitRange.lsb + selfWidth - 1
        } else if (direction == 'down') {
          self.bitRange.msb = other.bitRange.lsb - 1
          self.bitRange.lsb = self.bitRange.msb - selfWidth + 1
        } else {
          toast.error('Invalid direction')
          return
        }
        updatedFields[index] = self
        updatedFields[otherIndex] = other
      }
    }
    setValue('fields', updatedFields)
  }

  return (
    <div className='flex h-full flex-col gap-4 overflow-x-auto p-4'>
      {/* ---------- Header ---------- */}
      <div className='flex flex-col gap-3'>
        <div className='flex items-center gap-2'>
          <input
            {...rf('name')}
            disabled={!isEditing}
            size={Math.max(watch('name')?.length || 1, 1)}
            className={cn(
              'm-0 border-none bg-transparent p-0',
              'focus:ring-0 focus:outline-none',
              'disabled:cursor-default disabled:opacity-100',
              'text-2xl font-bold'
            )}
          />

          {!isEditing ? (
            <Button
              variant='outline'
              size='icon'
              onClick={() => setIsEditing(true)}
              className='h-8 w-8'
            >
              <Pencil className='h-4 w-4' />
            </Button>
          ) : (
            <div className='flex items-center gap-2'>
              <Button
                onClick={onSave}
                className='h-8 w-8'
                variant='outline'
                size='icon'
              >
                <Save />
              </Button>
              <Button
                className='h-8 w-8'
                variant='outline'
                size='icon'
                onClick={onCancel}
              >
                <X />
              </Button>
              <span className='text-muted-foreground text-sm'>Editing...</span>
            </div>
          )}
        </div>

        <Badge className='font-mono'>
          0x{addr.toString(16).padStart(4, '0')}
        </Badge>

        {isEditing ? (
          <textarea
            {...rf('description')}
            rows={3}
            placeholder='Add description...'
            className={cn(
              'w-full',
              'border-none bg-transparent p-0',
              'focus:ring-0 focus:outline-none'
            )}
          />
        ) : (
          <p className='whitespace-pre-wrap'>{registerData.description}</p>
        )}
      </div>

      {/* ---------- Diagram ---------- */}
      <div className='flex w-full justify-center'>
        <RegisterDiagram
          fields={fields}
          dataWidth={dataWidth}
        />
      </div>

      {/* ---------- Table ---------- */}
      <div className='flex w-full grow justify-center'>
        <Table>
          <TableHeader>
            <TableRow>
              {isEditing && (
                <TableHead className='w-10 text-center'>Actions</TableHead>
              )}
              <TableHead className='min-w-40'>Field</TableHead>
              <TableHead className='min-w-20 text-center'>Bits</TableHead>
              <TableHead className='min-w-20 text-center'>Type</TableHead>
              <TableHead className='min-w-20 text-right'>Reset</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody className='relative'>
            {fullFields.map((field, i) => (
              <Fragment key={`registerField${i}`}>
                {/* INSERT LINE */}
                {canInsert && fields.length == 0 && (
                  <tr
                    className='bg-primary text-primary-foreground absolute z-10 flex h-1 w-full cursor-pointer items-center justify-center opacity-0 hover:opacity-100'
                    onClick={() => insertField(field.trueIndex)}
                  >
                    <td
                      colSpan={6}
                      className='bg-primary flex h-4 w-4 items-center justify-center rounded-xs'
                    >
                      <Plus className='h-3 w-3' />
                    </td>
                  </tr>
                )}

                <TableRow
                  className={cn(
                    field.name == 'RESERVED' &&
                      'bg-muted text-muted-foreground',
                    'align-top'
                  )}
                >
                  {field.name == 'RESERVED' ? (
                    <>
                      {isEditing && <TableCell />}

                      <TableCell className='align-top font-medium'>
                        {field.name}
                      </TableCell>

                      <TableCell className='text-center align-top font-mono'>
                        [{field.bitRange.msb}
                        {field.bitRange.msb !== field.bitRange.lsb &&
                          `:${field.bitRange.lsb}`}
                        ]
                      </TableCell>

                      <TableCell className='text-center align-top'>
                        <Badge variant='outline'>{field.type}</Badge>
                      </TableCell>

                      <TableCell className='text-right align-top font-mono'>
                        {hex(
                          field.resetValue,
                          field.bitRange.msb - field.bitRange.lsb + 1
                        )}
                      </TableCell>

                      <TableCell className='align-top'>{field.desc}</TableCell>
                    </>
                  ) : (
                    <>
                      {isEditing && (
                        <TableCell className='flex gap-1 text-center align-top'>
                          <Button
                            size='icon'
                            variant='outline'
                            className='h-6 w-6 cursor-pointer'
                            disabled={field.bitRange.lsb == 0}
                            onClick={() => swapField(field.trueIndex, 'up')}
                          >
                            <ChevronUp />
                          </Button>

                          <Button
                            size='icon'
                            variant='outline'
                            className='h-6 w-6 cursor-pointer'
                            disabled={field.bitRange.msb == dataWidth - 1}
                            onClick={() => swapField(field.trueIndex, 'down')}
                          >
                            <ChevronDown />
                          </Button>
                          <Button
                            variant='outline'
                            size='icon'
                            className='h-6 w-6 cursor-pointer'
                            onClick={() => removeField(field.trueIndex)}
                          >
                            <Trash2 className='text-destructive h-3 w-3' />
                          </Button>
                        </TableCell>
                      )}

                      <TableCell className='align-top font-medium'>
                        <FieldName
                          field={field}
                          isEditing={isEditing}
                          rf={rf}
                          watch={watch}
                        />
                      </TableCell>

                      <TableCell className='text-center align-top font-mono'>
                        <FieldBitRange
                          field={field}
                          isEditing={isEditing}
                          setValue={setValue}
                        />
                      </TableCell>

                      <TableCell className='flex items-center justify-center align-top'>
                        <FieldType
                          field={field}
                          isEditing={isEditing}
                          setValue={setValue}
                          watch={watch}
                        />
                      </TableCell>

                      <TableCell className='text-right align-top font-mono'>
                        <FieldResetValue
                          field={field}
                          isEditing={isEditing}
                          setValue={setValue}
                        />
                      </TableCell>

                      <TableCell className='align-top'>
                        <FieldDesc
                          field={field}
                          isEditing={isEditing}
                          rf={rf}
                        />
                      </TableCell>
                    </>
                  )}
                </TableRow>

                {/* INSERT LINE */}
                {canInsert && field.name !== 'RESERVED' && (
                  <tr
                    className='bg-primary text-primary-foreground absolute z-10 flex h-1 w-full cursor-pointer items-center justify-center opacity-0 hover:opacity-100'
                    onClick={() => insertField(field.trueIndex)}
                  >
                    <td
                      colSpan={6}
                      className='bg-primary flex h-4 w-4 items-center justify-center rounded-xs'
                    >
                      <Plus className='h-3 w-3' />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
