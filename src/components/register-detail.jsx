import { useEffect, useState, useRef, Fragment } from 'react'
import { useForm } from 'react-hook-form'

import {
  normalizeRegister,
  getFieldWidth,
  calcTotalBitsUsed,
  formatArrayAddress,
  formatArrayRange,
  fieldIssues,
  formatBitRange,
  isLiteralCount,
  parseBitRange,
  resolveFields,
  resolveWidth,
} from '@/lib/register'
import { accessTypes } from '@/lib/access-types'
import { buildAddressMap } from '@/lib/address-map'
import { deleteRegister } from '@/lib/delete-register'
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
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { hex } from '@/lib/number-formating'

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

const FieldBitRange = ({
  field,
  isEditing,
  setValue,
  isOverlap,
  parameters,
  dataWidth,
}) => {
  const inputRef = useRef(null)

  const display = formatBitRange(
    field.bitRange.msb,
    field.bitRange.lsb,
    field.bitRange.width
  )
  const [local, setLocal] = useState(display)

  // Sync when field changes (insert/reset).
  useEffect(() => {
    setLocal(display)
  }, [display])

  if (!isEditing) {
    return <>{display}</>
  }

  const onBlur = () => {
    const parsed = parseBitRange(local)
    const width = resolveWidth(parsed, parameters)

    // A width expression must name a declared parameter, and whatever it
    // resolves to still has to fit the register without overlapping.
    const msb = width == null ? NaN : parsed.lsb + width - 1
    const tooWide = msb >= dataWidth
    const invalid =
      Number.isNaN(msb) ||
      Number.isNaN(parsed.lsb) ||
      msb < parsed.lsb ||
      parsed.lsb < 0 ||
      tooWide ||
      (isOverlap && isOverlap(field.trueIndex, msb, parsed.lsb))

    if (invalid) {
      // rollback + refocus
      toast.error(
        width == null
          ? `'${parsed.width}' is not a declared parameter`
          : tooWide
            ? `Bit ${msb} is past the ${dataWidth}-bit register`
            : 'Invalid bit range'
      )
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
      return
    }

    // ---- commit ----
    setValue(
      `fields.${field.trueIndex}.bitRange`,
      // msb is stored resolved so the diagram, overlap checks and Excel keep
      // working on plain numbers; width is what the RTL is generated from.
      parsed.width == null
        ? { msb, lsb: parsed.lsb }
        : { msb, lsb: parsed.lsb, width: parsed.width },
      { shouldDirty: true }
    )

    setLocal(formatBitRange(msb, parsed.lsb, parsed.width))
  }

  return (
    <input
      ref={inputRef}
      type='text'
      value={local}
      title='e.g. [15:8], [3], or [8 +: NUM_LANES] for a parameter-wide field'
      onChange={(e) => setLocal(e.target.value)}
      onBlur={onBlur}
      className={cn(
        'w-28 border-none bg-transparent p-0 text-center font-mono',
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
        {accessTypes.map((type) => (
          <SelectItem
            key={type.value}
            value={type.value}
            title={type.description}
          >
            {type.value}
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

  // Sync when field changes (reset/insert).
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
      toast.error('Invalid reset value')
      // setLocal(hex(field.resetValue, bitWidth))
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

    // Normalize display (hex).
    setLocal(hex(parsed, bitWidth))
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

/**
 * Turns a register into a repeated bank: `count` is a declared parameter name
 * or a literal, `stride` is the byte distance between instances, and instances
 * start at `firstIndex` (1 when index 0 lives in legacy registers).
 */
const RegisterArrayEditor = ({ addr, array, parameters, addrWidth, step, onChange }) => {
  const countIsValid =
    isLiteralCount(array?.count) ||
    parameters.some((parameter) => parameter.name === array?.count)

  return (
    <div className='flex flex-col gap-2 rounded-md border p-3'>
      <div className='flex items-center gap-2'>
        <Switch
          id='array-toggle'
          checked={Boolean(array)}
          onCheckedChange={(checked) =>
            onChange(
              checked
                ? { count: parameters[0]?.name ?? '2', stride: step, firstIndex: 0 }
                : undefined
            )
          }
        />
        <label
          htmlFor='array-toggle'
          className='text-sm'
        >
          Repeat as array
        </label>
      </div>

      {array && (
        <>
          <div className='flex flex-wrap items-end gap-3'>
            <label className='flex flex-col gap-1 text-xs'>
              Count
              <input
                className='h-7 w-40 rounded-md border px-2 font-mono text-sm'
                value={array.count ?? ''}
                onChange={(event) => {
                  const raw = event.target.value.trim()
                  onChange({
                    ...array,
                    count: isLiteralCount(raw) ? Number(raw) : raw,
                  })
                }}
              />
            </label>

            <label className='flex flex-col gap-1 text-xs'>
              Stride (bytes)
              <input
                type='number'
                className='h-7 w-24 rounded-md border px-2 font-mono text-sm'
                value={array.stride ?? step}
                onChange={(event) =>
                  onChange({ ...array, stride: Number(event.target.value) })
                }
              />
            </label>

            <label className='flex flex-col gap-1 text-xs'>
              First index
              <input
                type='number'
                className='h-7 w-24 rounded-md border px-2 font-mono text-sm'
                value={array.firstIndex ?? 0}
                onChange={(event) =>
                  onChange({ ...array, firstIndex: Number(event.target.value) })
                }
              />
            </label>
          </div>

          {parameters.length > 0 && (
            <div className='flex flex-wrap items-center gap-1 text-xs'>
              <span className='text-muted-foreground'>Parameters:</span>
              {parameters.map((parameter) => (
                <button
                  key={parameter.name}
                  type='button'
                  className='hover:bg-accent rounded-md border px-1.5 py-0.5 font-mono'
                  title={`${parameter.name} = ${parameter.value}`}
                  onClick={() => onChange({ ...array, count: parameter.name })}
                >
                  {parameter.name}
                </button>
              ))}
            </div>
          )}

          <p
            className={cn(
              'font-mono text-xs',
              countIsValid ? 'text-muted-foreground' : 'text-destructive'
            )}
          >
            {countIsValid
              ? `${formatArrayAddress(addr, array, addrWidth)}, ${formatArrayRange(array)}`
              : `'${array.count}' is not a declared parameter or a positive integer`}
          </p>
        </>
      )}
    </div>
  )
}

const FieldInsertLine = ({ show, onClick }) => {
  if (!show) return null

  return (
    <tr
      className='bg-primary text-primary-foreground absolute z-10 flex h-1 w-full cursor-pointer items-center justify-center opacity-0 hover:opacity-100'
      onClick={onClick}
    >
      <td
        colSpan={6}
        className='bg-primary flex h-4 w-4 items-center justify-center rounded-xs'
      >
        <Plus className='h-3 w-3' />
      </td>
    </tr>
  )
}


export const RegisterDetail = () => {
  const { dataWidth, addrWidth, parameters } = useParamStore()
  const step = dataWidth / 8

  const addr = useCurrentRegisterStore((s) => s.currentRegister)
  const setCurrentRegister = useCurrentRegisterStore((s) => s.setCurrentRegister)
  const registerData = useRegisterStore((s) =>
    addr != null ? s.registers[addr] : null
  )
  const updateRegister = useRegisterStore((s) => s.updateRegister)

  const [isEditing, setIsEditing] = useState(false)
  // Bit position of the field under the cursor, shared by the table and the
  // diagram so hovering either one lights up the other.
  const [highlightLsb, setHighlightLsb] = useState(null)

  const {
    register: rf,
    watch,
    reset,
    handleSubmit,
    setValue,
  } = useForm({
    defaultValues: registerData,
  })

  // Sync when register changes.
  useEffect(() => {
    if (registerData) {
      reset(registerData)
      setIsEditing(false)
    }
  }, [registerData, reset])

  if (!registerData) return null

  const registerArray = watch('array')

  // Parameter-wide fields carry a resolved msb, but the parameter may have
  // changed since it was written, so resolve again before laying anything out.
  const fields = resolveFields(watch('fields'), parameters ?? [])

  // Editing a bit range validates it, but a parameter can be widened or
  // renamed later, so the register is re-checked on every render.
  const issues = fieldIssues(watch('fields'), dataWidth, parameters ?? [])

  const fullFields = normalizeRegister(fields, dataWidth)

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

  /**
   * A bank is several registers sharing one stride, interleaved from the same
   * base (addr_low @ +0, addr_high @ +4, ctl @ +8). This drops the next one in
   * at the first free word inside the stride.
   */
  const addBankSibling = () => {
    const { registers, createRegister, patchRegister } =
      useRegisterStore.getState()
    const taken = buildAddressMap(registers, parameters ?? [])

    let next = addr + step
    while (next < addr + registerArray.stride && taken.has(next)) {
      next += step
    }

    if (next >= addr + registerArray.stride) {
      toast.error('No free word left inside this bank stride')
      return
    }

    let name = `${registerData.name}_2`
    for (let suffix = 2; Object.values(registers).some((r) => r.name === name); suffix += 1) {
      name = `${registerData.name}_${suffix + 1}`
    }

    createRegister(next)
    patchRegister(next, {
      name,
      description: registerData.description,
      array: { ...registerArray },
      fields: [],
    })
    setCurrentRegister(next)
    toast.success(`Added ${name} to the bank at 0x${next.toString(16)}`)
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
    const selfWidth = getFieldWidth(self)

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

      const otherWidth = getFieldWidth(other)

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
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='icon'
                onClick={() => setIsEditing(true)}
                className='h-8 w-8'
                title='Edit register'
              >
                <Pencil className='h-4 w-4' />
              </Button>

              <Button
                variant='outline'
                size='icon'
                onClick={() => deleteRegister(addr)}
                className='h-8 w-8'
                title={`Delete ${registerData.name}`}
              >
                <Trash2 className='text-destructive h-4 w-4' />
              </Button>
            </div>
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

        <div className='flex flex-wrap items-center gap-2'>
          <Badge className='font-mono'>
            0x{addr.toString(16).padStart(4, '0')}
          </Badge>

          {registerArray && (
            <Badge
              variant='secondary'
              className='font-mono'
              title={formatArrayRange(registerArray)}
            >
              ×{registerArray.count} · {formatArrayAddress(addr, registerArray, addrWidth)}
            </Badge>
          )}

          {registerArray && !isEditing && (
            <Button
              variant='outline'
              size='sm'
              className='h-6'
              title='Create another register interleaved into this bank'
              onClick={addBankSibling}
            >
              <Plus className='h-3 w-3' />
              Add to bank
            </Button>
          )}
        </div>

        {isEditing && (
          <RegisterArrayEditor
            addr={addr}
            array={registerArray}
            parameters={parameters ?? []}
            addrWidth={addrWidth}
            step={step}
            onChange={(next) =>
              setValue('array', next, { shouldDirty: true })
            }
          />
        )}

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

      {/* ---------- Issues ---------- */}
      {issues.length > 0 && (
        <div className='border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-sm'>
          <ul className='space-y-1'>
            {issues.map((issue, index) => (
              <li key={`issue${index}`}>
                <span className='font-medium'>{issue.name}</span>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- Diagram ---------- */}
      <div className='flex w-full justify-center'>
        <RegisterDiagram
          fields={fields}
          dataWidth={dataWidth}
          highlightLsb={highlightLsb}
          onHighlight={setHighlightLsb}
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
                {/* ---------- Insert Line ---------- */}
                <FieldInsertLine
                  show={canInsert && fields.length === 0}
                  onClick={() => insertField(field.trueIndex)}
                />

                <TableRow
                  className={cn(
                    // TableRow ships with transition-colors; hover highlighting
                    // should track the cursor, not fade in behind it.
                    'transition-none',
                    field.name == 'RESERVED' &&
                      'bg-muted text-muted-foreground',
                    // Not bg-accent: it resolves to the same value as bg-muted,
                    // so a highlighted RESERVED row would not change at all.
                    highlightLsb === field.bitRange.lsb &&
                      'bg-muted-foreground/25',
                    'align-top'
                  )}
                  onMouseEnter={() => setHighlightLsb(field.bitRange.lsb)}
                  onMouseLeave={() => setHighlightLsb(null)}
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
                          parameters={parameters ?? []}
                          dataWidth={dataWidth}
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

                {/* ---------- Insert Line ---------- */}
                <FieldInsertLine
                  show={canInsert && field.name !== 'RESERVED'}
                  onClick={() => insertField(field.trueIndex)}
                />
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

