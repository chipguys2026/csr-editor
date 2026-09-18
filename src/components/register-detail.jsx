import { useEffect, useLayoutEffect, useState, useRef, Fragment } from 'react'
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
import { accessTypes, holdCyclesOf } from '@/lib/access-types'
import { buildAddressMap } from '@/lib/address-map'
import { deleteRegister } from '@/lib/delete-register'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { useCurrentRegisterStore } from '@/store/current-register-store'

import { GripVertical, Pencil, Plus, Save, Trash2, X } from 'lucide-react'

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
import { Label } from '@/components/ui/label'
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

// Sentinels for the two "not a parameter" menu entries.
const LITERAL_COUNT = '__number__'
const FIXED_WIDTH = '__fixed__'

/**
 * The table renders fields sorted by bit position but writes edits back by
 * array index, and the insert/move helpers shift neighbours assuming the array
 * is in bit order too. Sorting on load keeps those in step: without it, a
 * register whose JSON lists fields out of order (CTRL has flush after
 * enc_active) sends every edit on those rows to the wrong field.
 */
const inBitOrder = (register) =>
  register && {
    ...register,
    fields: [...(register.fields ?? [])].sort(
      (a, b) => a.bitRange.lsb - b.bitRange.lsb
    ),
  }

// ----------------------------------------------

const FieldName = ({ field, isEditing, rf }) => {
  return (
    <input
      {...rf(`fields.${field.trueIndex}.name`)}
      disabled={!isEditing}
      className={cn(
        // min-w-0 so the input cannot push its column wider than the header.
        'w-full min-w-0 border-none bg-transparent p-0',
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

  // Picking a parameter rewrites the range as [lsb +: PARAM]; fixed freezes it
  // back to whatever width it currently resolves to.
  const onWidthSource = (value) => {
    const lsb = field.bitRange.lsb
    const width =
      value === FIXED_WIDTH
        ? field.bitRange.msb - lsb + 1
        : resolveWidth({ lsb, width: value }, parameters)

    setValue(
      `fields.${field.trueIndex}.bitRange`,
      value === FIXED_WIDTH
        ? { msb: lsb + width - 1, lsb }
        : { msb: lsb + width - 1, lsb, width: value },
      { shouldDirty: true }
    )
  }

  // Typing stays the primary route, with the parameters as completions.
  const suggestionsId = `bits-${field.trueIndex}`
  const suggestions = [
    formatBitRange(field.bitRange.msb, field.bitRange.lsb),
    ...parameters.map(
      (parameter) => `[${field.bitRange.lsb} +: ${parameter.name}]`
    ),
  ]

  return (
    <div className='flex items-center gap-1'>
      <input
        ref={inputRef}
        type='text'
        value={local}
        list={parameters.length > 0 ? suggestionsId : undefined}
        title='e.g. [15:8], [3], or [8 +: NUM_LANES] for a parameter-wide field'
        onChange={(e) => setLocal(e.target.value)}
        onBlur={onBlur}
        className={cn(
          'min-w-0 flex-1 border-none bg-transparent p-0 text-center font-mono',
          'focus:ring-0 focus:outline-none'
        )}
      />

      {parameters.length > 0 && (
        <datalist id={suggestionsId}>
          {[...new Set(suggestions)].map((suggestion) => (
            <option
              key={suggestion}
              value={suggestion}
            />
          ))}
        </datalist>
      )}

      {/* Held at the empty option so it always reads as one glyph rather than
          echoing the width the range already shows. A native select keeps it
          clickable in a dense table without a portal. */}
      {parameters.length > 0 && (
        <select
          value=''
          onChange={(event) =>
            event.target.value && onWidthSource(event.target.value)
          }
          title='Size this field with a parameter'
          className={cn(
            'text-muted-foreground hover:text-foreground w-4 shrink-0 cursor-pointer',
            'appearance-none border-none bg-transparent p-0 text-center font-mono',
            'text-sm italic outline-none'
          )}
        >
          <option value=''>ƒ</option>
          <option value={FIXED_WIDTH}>Fixed width</option>
          {parameters.map((parameter) => (
            <option
              key={parameter.name}
              value={parameter.name}
            >
              {parameter.name} bits
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

/**
 * The access type, plus the hold window when it is one that has one. W1SC is
 * the only type carrying a setting of its own, so it rides along with the type
 * rather than costing every row a column.
 */
const FieldType = ({ field, isEditing, watch, setValue }) => {
  const path = `fields.${field.trueIndex}.type`
  const holdPath = `fields.${field.trueIndex}.holdCycles`
  const value = watch(path)

  if (!isEditing) {
    return (
      <div className='flex items-center justify-center gap-1'>
        <Badge variant='outline'>{field.type}</Badge>

        {field.type === 'W1SC' && (
          <Badge
            variant='secondary'
            className='font-mono'
            title={`Asserted for ${holdCyclesOf(field)} clocks after a write-1`}
          >
            {holdCyclesOf(field)}
          </Badge>
        )}
      </div>
    )
  }

  return (
    <div className='flex items-center gap-1'>
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

      {value === 'W1SC' && (
        <input
          type='text'
          inputMode='numeric'
          value={watch(holdPath) ?? holdCyclesOf(field)}
          title='Clocks the output stays asserted before it clears itself'
          onChange={(event) =>
            setValue(holdPath, event.target.value.replace(/[^0-9]/g, ''), {
              shouldDirty: true,
            })
          }
          onBlur={(event) => {
            // An empty or zero window means "just use the default".
            const next = Number(event.target.value)
            setValue(holdPath, Number.isInteger(next) && next > 0 ? next : null, {
              shouldDirty: true,
            })
          }}
          className='border-input h-6 w-12 rounded-md border bg-transparent px-1 text-center font-mono text-xs'
        />
      )}
    </div>
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
        'w-full min-w-0 border-none bg-transparent p-0 text-right font-mono',
        'focus:ring-0 focus:outline-none'
      )}
    />
  )
}

const fitToContent = (textarea) => {
  if (!textarea) return

  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

/**
 * A textarea that stands exactly as tall as its text, so editing shows the same
 * lines the read-only view does and leaves no dead space below them. Counts
 * lines produced by wrapping, which a rows attribute cannot.
 */
const AutoGrowTextarea = ({ registered, value, className, ...props }) => {
  const { ref: registerRef, ...rest } = registered
  const textareaRef = useRef(null)

  useLayoutEffect(() => fitToContent(textareaRef.current), [value])

  return (
    <textarea
      {...rest}
      {...props}
      ref={(node) => {
        registerRef(node)
        textareaRef.current = node
      }}
      rows={1}
      onInput={(event) => fitToContent(event.currentTarget)}
      className={cn(
        // A textarea's intrinsic width comes from its cols attribute, which
        // would otherwise widen the whole table in edit mode.
        'w-full min-w-0 resize-none overflow-hidden border-none bg-transparent p-0',
        'focus:ring-0 focus:outline-none',
        className
      )}
    />
  )
}

const FieldDesc = ({ field, isEditing, rf, watch }) => {
  const path = `fields.${field.trueIndex}.desc`

  if (!isEditing) {
    return <span className='whitespace-pre-wrap'>{field.desc}</span>
  }

  return (
    <AutoGrowTextarea
      registered={rf(path)}
      value={watch(path)}
      data-row={field.trueIndex}
      data-col='desc'
    />
  )
}

/**
 * Turns a register into a repeated bank: `count` is a declared parameter name
 * or a literal, `stride` is the byte distance between instances, and instances
 * start at `firstIndex` (1 when index 0 lives in legacy registers).
 *
 * Renders as a fragment so it sits inline with the address in a wrapping row:
 * off, it is just a switch; on, the controls and the resolved address
 * expression wrap onto their own lines.
 */
const RegisterArrayEditor = ({ addr, array, parameters, addrWidth, step, onChange }) => {
  const countIsParameter = parameters.some(
    (parameter) => parameter.name === array?.count
  )
  const countIsValid = countIsParameter || isLiteralCount(array?.count)

  const numberInput = (key, label, fallback) => (
    <label
      className='text-muted-foreground flex items-center gap-1 text-xs'
      title={label}
    >
      {label}
      <input
        type='number'
        className='h-6 w-16 rounded-md border px-1 font-mono text-xs'
        value={array[key] ?? fallback}
        onChange={(event) => onChange({ ...array, [key]: Number(event.target.value) })}
      />
    </label>
  )

  return (
    <>
      <label className='flex items-center gap-1.5 text-sm'>
        <Switch
          checked={Boolean(array)}
          onCheckedChange={(checked) =>
            onChange(
              checked
                ? { count: parameters[0]?.name ?? '2', stride: step, firstIndex: 0 }
                : undefined
            )
          }
        />
        Array
      </label>

      {array && (
        <>
          {parameters.length > 0 && (
            <Select
              value={countIsParameter ? array.count : LITERAL_COUNT}
              onValueChange={(value) =>
                onChange({
                  ...array,
                  count: value === LITERAL_COUNT ? Number(array.count) || 2 : value,
                })
              }
            >
              <SelectTrigger
                data-size='none'
                className='h-6 gap-1 px-1 py-0 font-mono text-xs'
                title='Count: a declared parameter, or a fixed number'
              >
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                {parameters.map((parameter) => (
                  <SelectItem
                    key={parameter.name}
                    value={parameter.name}
                    title={`${parameter.name} = ${parameter.value}`}
                  >
                    {parameter.name}
                  </SelectItem>
                ))}
                <SelectItem value={LITERAL_COUNT}>Number…</SelectItem>
              </SelectContent>
            </Select>
          )}

          {!countIsParameter &&
            numberInput('count', parameters.length > 0 ? '' : 'count', 2)}

          {numberInput('stride', 'stride', step)}
          {numberInput('firstIndex', 'from', 0)}

          {/* w-full breaks the wrapping row, so this always gets its own line */}
          <p
            className={cn(
              'w-full font-mono text-xs',
              countIsValid ? 'text-muted-foreground' : 'text-destructive'
            )}
          >
            {countIsValid
              ? `${formatArrayAddress(addr, array, addrWidth)}, ${formatArrayRange(array)}`
              : `'${array.count}' is not a declared parameter or a positive integer`}
          </p>
        </>
      )}
    </>
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
  // Field being dragged, and the row it is currently over.
  const [dragField, setDragField] = useState(null)
  const [dropField, setDropField] = useState(null)
  // Set while the address badge is being edited.
  const [addressDraft, setAddressDraft] = useState(null)

  const {
    register: rf,
    watch,
    reset,
    handleSubmit,
    setValue,
  } = useForm({
    defaultValues: inBitOrder(registerData),
  })

  // Sync when register changes.
  useEffect(() => {
    if (registerData) {
      reset(inBitOrder(registerData))
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

  // The Bits column follows the widest range in this register: a single fixed
  // width is wasteful for [3] and clips [8 +: NUM_LANES]. Measured from the
  // labels alone, so it does not change between view and edit mode.
  const bitsColumnChars = Math.max(
    'Bits'.length,
    ...fullFields.map(
      (field) =>
        formatBitRange(field.bitRange.msb, field.bitRange.lsb, field.bitRange.width)
          .length
    )
  )

  // Reset follows its widest value for the same reason: a reserved span across
  // the top of the register renders 0x00000000, which ran under the
  // description at the fixed width the column used to have.
  const resetColumnChars = Math.max(
    'Reset'.length,
    ...fullFields.map(
      (field) =>
        hex(field.resetValue, field.bitRange.msb - field.bitRange.lsb + 1).length
    )
  )

  // W1SC carries a hold window beside its access type, which does not fit the
  // width the column has when every row is just a badge or a select.
  const hasHoldWindow = fullFields.some((field) => field.type === 'W1SC')

  const totalBitsUsed = calcTotalBitsUsed(fields)
  const canInsert = isEditing && totalBitsUsed < dataWidth

  const onSave = handleSubmit((formData) => {
    // Guarded as well as disabled, so a keyboard submit cannot slip a register
    // with overlapping or oversized fields into the document.
    if (issues.length > 0) {
      toast.error(`Fix ${issues.length} field problem(s) before saving`)
      return
    }

    updateRegister(addr, formData)
    setIsEditing(false)
  })

  const onCancel = () => {
    reset(inBitOrder(registerData))
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

  /**
   * Drop a field at another field's position. Widths are preserved and the
   * gaps keep their place in the sequence, so a bank of reserved bits stays
   * between the same two neighbours instead of being packed away.
   */
  const moveField = (fromIndex, toIndex) => {
    if (fromIndex === toIndex || fields[fromIndex] == null || fields[toIndex] == null) {
      return
    }

    const gaps = []
    let cursor = 0
    for (const [index, field] of fields.entries()) {
      gaps[index] = field.bitRange.lsb - cursor
      cursor = field.bitRange.msb + 1
    }

    const reordered = [...fields]
    reordered.splice(toIndex, 0, ...reordered.splice(fromIndex, 1))

    let bit = 0
    const relaid = reordered.map((field, index) => {
      bit += gaps[index]
      const width = getFieldWidth(field)
      const placed = {
        ...field,
        bitRange: { ...field.bitRange, lsb: bit, msb: bit + width - 1 },
      }
      bit += width
      return placed
    })

    setValue('fields', relaid, { shouldDirty: true })
  }

  /**
   * Drops are addressed by bit, so a reserved gap is a valid destination: the
   * field takes the position in the sequence that the gap occupies.
   */
  const commitAddress = () => {
    const raw = addressDraft.trim().toLowerCase()
    const next = /^0x[0-9a-f]+$/.test(raw)
      ? parseInt(raw.slice(2), 16)
      : /^\d+$/.test(raw)
        ? Number(raw)
        : NaN

    setAddressDraft(null)
    if (Number.isNaN(next) || next === addr) return

    if (next < 0 || next >= 2 ** addrWidth) {
      toast.error(`Address must fit in ${addrWidth} bits`)
      return
    }

    if (next % step !== 0) {
      toast.error(`Address must be ${step}-byte aligned`)
      return
    }

    const { registers, moveRegister } = useRegisterStore.getState()
    const taken = buildAddressMap(
      Object.fromEntries(
        Object.entries(registers).filter(([key]) => Number(key) !== addr)
      ),
      parameters ?? []
    )

    if (taken.has(next)) {
      toast.error(`${hex(next, addrWidth)} is taken by ${taken.get(next)[0].name}`)
      return
    }

    moveRegister(addr, next)
    setCurrentRegister(next)
    toast.success(`Moved ${registerData.name} to ${hex(next, addrWidth)}`)
  }

  const moveFieldToBit = (fromLsb, targetBit) => {
    const from = fields.findIndex((field) => field.bitRange.lsb === fromLsb)
    if (from < 0) return

    // Onto another field: take its place in the sequence.
    const onField = fields.findIndex(
      (field) => targetBit >= field.bitRange.lsb && targetBit <= field.bitRange.msb
    )
    if (onField >= 0) {
      moveField(from, onField)
      return
    }

    // Into free space: park it at the start of the hole and leave every other
    // field where it is. Measured with the dragged field lifted out, so the
    // bits it vacates count as part of the hole.
    const others = fields.filter((_, index) => index !== from)
    const before = others.filter((field) => field.bitRange.msb < targetBit).pop()
    const after = others.find((field) => field.bitRange.lsb > targetBit)
    const gapStart = before ? before.bitRange.msb + 1 : 0
    const gapEnd = after ? after.bitRange.lsb - 1 : dataWidth - 1
    const width = getFieldWidth(fields[from])

    if (gapEnd - gapStart + 1 >= width) {
      const moved = {
        ...fields[from],
        bitRange: {
          ...fields[from].bitRange,
          lsb: gapStart,
          msb: gapStart + width - 1,
        },
      }

      setValue(
        'fields',
        [...others, moved].sort((a, b) => a.bitRange.lsb - b.bitRange.lsb),
        { shouldDirty: true }
      )
      return
    }

    // Too wide for the hole: fall back to taking that spot in the sequence.
    const afterGap = fields.findIndex((field) => field.bitRange.lsb > targetBit)
    moveField(from, afterGap >= 0 ? afterGap : fields.length - 1)
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
                disabled={issues.length > 0}
                title={
                  issues.length > 0
                    ? `Fix ${issues.length} field problem(s) before saving`
                    : 'Save register'
                }
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

        {/* Address row: the array controls live here rather than in a block of
            their own, so an ordinary register costs one small switch. */}
        <div className='flex flex-wrap items-center gap-2'>
          {/* Editing the address moves this register on its own, which is how
              a gap of any size gets opened without shifting the whole map. */}
          {addressDraft == null ? (
            <Badge
              className='cursor-pointer font-mono'
              title='Click to change this address'
              onClick={() => setAddressDraft(hex(addr, addrWidth))}
            >
              {hex(addr, addrWidth)}
            </Badge>
          ) : (
            <input
              autoFocus
              value={addressDraft}
              onChange={(event) => setAddressDraft(event.target.value)}
              onBlur={commitAddress}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') setAddressDraft(null)
              }}
              className='border-input h-6 w-24 rounded-md border bg-transparent px-2 font-mono text-sm'
            />
          )}

          {registerArray && !isEditing && (
            <>
              <Badge
                variant='secondary'
                className='font-mono'
                title={formatArrayRange(registerArray)}
              >
                ×{registerArray.count} ·{' '}
                {formatArrayAddress(addr, registerArray, addrWidth)}
              </Badge>

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
            </>
          )}

          {isEditing && (
            <RegisterArrayEditor
              addr={addr}
              array={registerArray}
              parameters={parameters ?? []}
              addrWidth={addrWidth}
              step={step}
              onChange={(next) => setValue('array', next, { shouldDirty: true })}
            />
          )}

          {(isEditing || watch('writeStrobe')) && (
            <div className='flex items-center gap-2'>
              <Switch
                id='write-strobe'
                checked={Boolean(watch('writeStrobe'))}
                disabled={!isEditing}
                onCheckedChange={(checked) =>
                  setValue('writeStrobe', checked, { shouldDirty: true })
                }
              />
              <Label
                htmlFor='write-strobe'
                className='text-muted-foreground text-sm font-normal'
              >
                Write strobe
              </Label>
            </div>
          )}
        </div>

        {isEditing ? (
          <AutoGrowTextarea
            registered={rf('description')}
            value={watch('description')}
            placeholder='Add description...'
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
          onMoveField={isEditing ? moveFieldToBit : undefined}
        />
      </div>

      {/* ---------- Table ---------- */}
      <div className='flex w-full grow justify-center'>
        {/* table-fixed: columns follow the header widths instead of the widest
            content, so switching to edit mode cannot re-flow or widen the
            table just because its cells became inputs. */}
        <Table className='table-fixed'>
          <TableHeader>
            <TableRow>
              {/* Widths are held constant across view and edit mode: the
                  columns are always present, so the table does not jump when
                  the row actions and inputs appear. */}
              <TableHead className='w-24 text-center'>
                {isEditing ? 'Actions' : ''}
              </TableHead>
              <TableHead className='w-44'>Field</TableHead>
              {/* font-mono so the ch unit measures the same glyphs the cells
                  below use; the slack covers padding and the ƒ button. */}
              <TableHead
                className='text-center font-mono'
                style={{ width: `calc(${bitsColumnChars}ch + 3rem)` }}
              >
                Bits
              </TableHead>
              <TableHead
                className='text-center'
                style={{ width: hasHoldWindow ? '10rem' : '6rem' }}
              >
                Type
              </TableHead>
              <TableHead
                className='text-right font-mono'
                style={{ width: `calc(${resetColumnChars}ch + 2rem)` }}
              >
                Reset
              </TableHead>
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
                    dropField === field.bitRange.lsb &&
                      dragField !== field.trueIndex &&
                      'border-foreground border-t-2',
                    'align-top'
                  )}
                  onDragOver={(event) => {
                    if (dragField == null) return
                    event.preventDefault()
                    setDropField(field.bitRange.lsb)
                  }}
                  onDrop={(event) => {
                    if (dragField == null) return
                    event.preventDefault()
                    moveFieldToBit(
                      fields[dragField]?.bitRange.lsb,
                      field.bitRange.lsb
                    )
                    setDragField(null)
                    setDropField(null)
                  }}
                  onMouseEnter={() => setHighlightLsb(field.bitRange.lsb)}
                  onMouseLeave={() => setHighlightLsb(null)}
                >
                  {field.name == 'RESERVED' ? (
                    <>
                      <TableCell />

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
                      <TableCell className='align-top'>
                        {isEditing && (
                          <div className='flex items-center gap-1'>
                            {/* draggable sits on the handle, not the row, so
                                dragging inside a cell still selects text. */}
                            <div
                              draggable
                              title='Drag to move this field'
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = 'move'
                                const row = event.currentTarget.closest('tr')
                                if (row) event.dataTransfer.setDragImage(row, 0, 0)
                                setDragField(field.trueIndex)
                              }}
                              onDragEnd={() => {
                                setDragField(null)
                                setDropField(null)
                              }}
                              className={cn(
                                'text-muted-foreground hover:text-foreground',
                                'flex h-6 w-6 cursor-grab items-center justify-center',
                                'rounded-md border active:cursor-grabbing'
                              )}
                            >
                              <GripVertical className='h-3 w-3' />
                            </div>

                            <Button
                              variant='outline'
                              size='icon'
                              className='h-6 w-6 cursor-pointer'
                              onClick={() => removeField(field.trueIndex)}
                            >
                              <Trash2 className='text-destructive h-3 w-3' />
                            </Button>
                          </div>
                        )}
                      </TableCell>

                      <TableCell className='align-top font-medium'>
                        <FieldName
                          field={field}
                          isEditing={isEditing}
                          rf={rf}
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

                      {/* No flex on the cell itself: display:flex takes it out
                          of the table layout, so the column stops lining up
                          with its header and the other rows. */}
                      <TableCell className='text-center align-top'>
                        <div className='flex items-center justify-center'>
                          <FieldType
                            field={field}
                            isEditing={isEditing}
                            setValue={setValue}
                            watch={watch}
                          />
                        </div>
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
                          watch={watch}
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

