import React, { useRef, useState } from 'react'
import { FoldVertical, Plus, Search, Trash2, UnfoldVertical, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { deleteRegister } from '@/lib/delete-register'
import { hex } from '@/lib/number-formating'
import { fieldIssues, formatArrayRange } from '@/lib/register'
import { buildAddressMap, buildRows, hasConflict } from '@/lib/address-map'
import { useVirtualizer } from '@tanstack/react-virtual'

import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { useCurrentRegisterStore } from '@/store/current-register-store'

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core'

import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

import { CSS } from '@dnd-kit/utilities'

import { cn } from '@/lib/utils'

// Row actions stay hidden until the row is hovered or the button is focused.
const rowActionClass =
  'hover:bg-accent ml-auto shrink-0 cursor-pointer rounded-sm p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none'

export const RegisterItem = ({
  addr,
  isDragging,
  dragDisabled,
  addrWidth,
  claims,
  issues,
  hoveredReg,
  onHoverReg,
  isSelected,
  onSelect: onSelectRow,
  onInsertBefore,
}) => {
  const reg = useRegisterStore((s) => s.registers[addr])

  const setCurrentRegister = useCurrentRegisterStore(
    (s) => s.setCurrentRegister
  )

  const sortable = useSortable({
    id: addr,
    disabled: !reg || dragDisabled,
  })

  const { setNodeRef, attributes, listeners, transform, transition } = sortable

  const style = {
    transform: CSS.Transform.toString(transform),
  }

  // Slots this register does not own itself, but that an array reaches into.
  const foreign = (claims ?? []).filter((entry) => entry.regAddr !== addr)
  const conflict = hasConflict(claims)
  const instance = reg ? null : foreign[0]

  // Every slot the hovered register reaches, so a bank lights up as a whole.
  const inHoveredBank =
    hoveredReg != null && (claims ?? []).some((entry) => entry.regAddr === hoveredReg)

  const owner = instance ? instance.regAddr : addr
  const onSelect = (event) =>
    onSelectRow ? onSelectRow(owner, event) : setCurrentRegister(owner)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group grid h-9 grid-cols-[auto_1fr] items-center gap-2',
        isDragging && 'opacity-0'
      )}
      onClick={onSelect}
      onMouseEnter={() => onHoverReg?.(instance ? instance.regAddr : reg ? addr : null)}
      onMouseLeave={() => onHoverReg?.(null)}
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        className={cn(
          'text-muted-foreground cursor-grab font-mono text-sm whitespace-nowrap',
          (!reg || dragDisabled) && 'cursor-default',
          !reg && 'opacity-50'
        )}
      >
        {hex(addr, addrWidth)}
      </span>

      <div
        className={cn(
          'flex h-full grow cursor-pointer items-center gap-2 border p-2',
          inHoveredBank && 'border-foreground/40 bg-muted-foreground/25',
          isSelected && 'border-foreground bg-muted-foreground/25',
          (conflict || issues?.length) && 'border-destructive text-destructive',
          instance && 'text-muted-foreground border-dashed'
        )}
        title={
          conflict
            ? `Address claimed by ${[...new Set(claims.map((entry) => entry.name))].join(' and ')}`
            : // A parameter can be widened from the panel while a completely
              // different register is on screen, so flag it here too.
              issues?.length
              ? issues.map((issue) => `${issue.name}: ${issue.message}`).join('\n')
              : undefined
        }
      >
        <span className='truncate font-mono text-sm'>
          {reg?.name ?? `${instance.name}[${instance.index}]`}
        </span>

        {reg?.array && (
          <span
            className='bg-muted text-muted-foreground shrink-0 rounded-sm px-1 font-mono text-xs'
            title={`${formatArrayRange(reg.array)}, stride ${reg.array.stride} bytes`}
          >
            ×{reg.array.count}
          </span>
        )}

        {reg && onInsertBefore && (
          <button
            type='button'
            title={`Insert a free word here, pushing ${reg.name} and everything above it up`}
            onClick={(event) => {
              event.stopPropagation()
              onInsertBefore()
            }}
            className={cn(rowActionClass, 'text-muted-foreground')}
          >
            <UnfoldVertical className='h-3.5 w-3.5' />
          </button>
        )}

        {reg && (
          <button
            type='button'
            title={`Delete ${reg.name}`}
            onClick={(event) => {
              event.stopPropagation()
              deleteRegister(addr)
            }}
            className={cn(rowActionClass, 'ml-0 text-destructive')}
          >
            <Trash2 className='h-3.5 w-3.5' />
          </button>
        )}
      </div>
    </div>
  )
}

/** A run of unused addresses, collapsed to one row and open as a drop target. */
const GapRow = ({ start, end, step, addrWidth, onCreate, onClose, onResize, onClear }) => {
  const words = (end - start) / step + 1
  // Null while the input is not being edited, so the row always shows the real
  // size without an effect to push it back in after a resize.
  const [draft, setDraft] = useState(null)
  const text = draft ?? String(words)

  const { setNodeRef } = useSortable({
    id: start,
    // Cannot be picked up, but a register can be dropped into it.
    disabled: { draggable: true, droppable: false },
  })

  const commit = () => {
    const next = Number(text)

    // Dropping the draft reverts the input to the real size, which is also
    // what rolls back a value that was not a word count.
    setDraft(null)

    if (!Number.isInteger(next) || next < 0) {
      return
    }

    if (next !== words) onResize(next)
  }

  return (
    <div
      ref={setNodeRef}
      className='group grid h-9 grid-cols-[auto_1fr] items-center gap-2'
      onClick={onClear}
    >
      <span className='text-muted-foreground font-mono text-sm whitespace-nowrap opacity-50'>
        {hex(start, addrWidth)}
      </span>

      <div className='text-muted-foreground flex h-full grow items-center gap-2 border border-dashed p-2'>
        {/* The size is the control: type a bigger number and everything above
            moves up to make room, which is how a large gap gets opened. */}
        {onResize ? (
          <span className='flex items-center gap-1 truncate'>
            Reserved ·
            <input
              value={text}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              onClick={(event) => event.stopPropagation()}
              title='Words reserved here; changing this moves everything above'
              className='border-input h-6 w-14 rounded-md border bg-transparent px-1 text-center font-mono text-xs'
            />
            words
          </span>
        ) : (
          <span className='truncate'>
            {words === 1
              ? 'Reserved'
              : `Reserved · ${words.toLocaleString()} words to ${hex(end, addrWidth)}`}
          </span>
        )}

        <button
          type='button'
          title={`Create a register at ${hex(start, addrWidth)}`}
          onClick={onCreate}
          className={rowActionClass}
        >
          <Plus className='h-3.5 w-3.5' />
        </button>

        {onClose && (
          <button
            type='button'
            title={`Close this gap, pulling the registers above it down by ${words} word(s)`}
            onClick={onClose}
            className={cn(rowActionClass, 'ml-0')}
          >
            <FoldVertical className='h-3.5 w-3.5' />
          </button>
        )}
      </div>
    </div>
  )
}

export const RegisterDragOverlay = ({ addr, addrWidth, reg }) => {
  return (
    <div className='grid h-9 grid-cols-[auto_1fr] items-center gap-2'>
      <span className='text-muted-foreground cursor-grabbing font-mono text-sm whitespace-nowrap'>
        {hex(addr, addrWidth)}
      </span>
      <div className='flex h-full grow items-center border p-2 font-mono text-sm'>
        {reg?.name ?? 'Reserved'}
      </div>
    </div>
  )
}

export const RegisterMap = () => {
  const parentRef = useRef(null)
  const [activeId, setActiveId] = useState(null)
  const [hoveredReg, setHoveredReg] = useState(null)
  const [newAddr, setNewAddr] = useState('')
  const [query, setQuery] = useState('')
  // Addresses picked out for a bulk move, plus the anchor a shift-click
  // extends the range from.
  const [selected, setSelected] = useState(() => new Set())
  const [anchor, setAnchor] = useState(null)

  const { addrWidth, dataWidth, parameters } = useParamStore()
  const moveInsert = useRegisterStore((s) => s.moveInsert)
  const registers = useRegisterStore((s) => s.registers)
  const activeRegisterName = useRegisterStore((s) =>
    activeId != null ? s.registers[activeId] : null
  )

  const createRegister = useRegisterStore((s) => s.createRegister)
  const setRegisters = useRegisterStore((s) => s.setRegisters)
  const setCurrentRegister = useCurrentRegisterStore((s) => s.setCurrentRegister)
  const currentRegister = useCurrentRegisterStore((s) => s.currentRegister)

  const addressMap = buildAddressMap(registers, parameters)

  const issuesByAddr = new Map(
    Object.entries(registers)
      .map(([addr, reg]) => [
        Number(addr),
        fieldIssues(reg?.fields, dataWidth, parameters),
      ])
      .filter(([, issues]) => issues.length > 0)
  )

  const step = dataWidth / 8
  // 2 ** addrWidth overflows past 53 bits, so cap the space at what a JS number
  // still indexes exactly. Addresses that high are unreachable in practice.
  const maxAddr = Math.min(2 ** addrWidth, Number.MAX_SAFE_INTEGER + 1) - step

  const allRows = buildRows(addressMap, step, maxAddr)

  /**
   * Matched against the name, the address in either base, the description and
   * the field names, since any of those is a reason to be looking for a
   * register. An array instance answers for the register it belongs to.
   */
  const needle = query.trim().toLowerCase()

  /**
   * 0 for a hit on what the register is called or where it lives, 1 for one
   * buried in prose, null for no hit. Prose is worth searching -- it is how
   * you find the register that mentions overflow -- but a word like Bayer
   * appears in dozens of descriptions and in one register name, and it is that
   * one you are looking for.
   */
  const rank = (addr) => {
    let best = null

    for (const entry of addressMap.get(addr) ?? []) {
      const reg = registers[entry.regAddr]
      if (!reg) continue

      const name = entry.index == null ? reg.name : `${reg.name}[${entry.index}]`
      const direct = [name, hex(addr, addrWidth), String(addr)]
      const prose = [
        reg.description ?? '',
        ...(reg.fields ?? []).flatMap((field) => [
          field.name ?? '',
          field.desc ?? '',
          // A flag or a coded value is often the thing being looked for, the
          // register it lives in being what you are trying to find out.
          ...(field.enumValues ?? []).map((value) => value?.name ?? ''),
        ]),
      ]

      const has = (parts) => parts.join('\n').toLowerCase().includes(needle)

      if (has(direct)) return 0
      if (best == null && has(prose)) best = 1
    }

    return best
  }

  // The free runs between registers mean nothing once the list is filtered, so
  // a search shows only what it found, what it was named for first.
  const rows = needle
    ? allRows
        .filter((row) => row.type === 'register')
        .map((row) => ({ row, rank: rank(row.addr) }))
        .filter((entry) => entry.rank != null)
        .sort((a, b) => a.rank - b.rank || a.row.addr - b.row.addr)
        .map((entry) => entry.row)
    : allRows

  const found = rows.filter((row) => registers[row.addr]).length

  const selectRow = (addr, event) => {
    const addresses = rows
      .filter((row) => row.type === 'register' && registers[row.addr])
      .map((row) => row.addr)

    if (event.shiftKey && anchor != null) {
      const from = addresses.indexOf(anchor)
      const to = addresses.indexOf(addr)

      if (from >= 0 && to >= 0) {
        const [low, high] = from < to ? [from, to] : [to, from]
        setSelected(new Set(addresses.slice(low, high + 1)))
        return
      }
    }

    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selected)
      next.has(addr) ? next.delete(addr) : next.add(addr)
      setSelected(next)
      setAnchor(addr)
      return
    }

    setSelected(new Set([addr]))
    setAnchor(addr)
    setCurrentRegister(addr)
  }

  /**
   * Drop the selected block so the row that was grabbed lands on `targetAddr`.
   * The block keeps its internal spacing. If it would land on registers that
   * are not moving, they are pushed up to make room rather than the drop being
   * refused - the same courtesy a single dragged register already gets.
   */
  const dropSelectionAt = (targetAddr, grabbedAddr) => {
    const block = [...selected].sort((a, b) => a - b)
    const placed = (addr) => targetAddr + (addr - grabbedAddr)
    const asIs = (addr) => (selected.has(addr) ? placed(addr) : addr)

    let addressOf = asIs
    let done = `Moved ${block.length} register(s)`

    if (tryRelocate(asIs).error) {
      const span = block[block.length - 1] - block[0] + step
      const landing = placed(block[0])

      addressOf = (addr) =>
        selected.has(addr) ? placed(addr) : addr >= landing ? addr + span : addr
      done = `Moved ${block.length} register(s), pushing the rest up`
    }

    if (relocate(addressOf, done)) {
      setSelected(new Set(block.map(placed)))
      setAnchor(anchor == null ? null : addressOf(anchor))
    }
  }

  const createAt = (addr) => {
    createRegister(addr)
    setCurrentRegister(addr)
  }

  /**
   * Slide every register at or above `fromAddr` by `delta` bytes, which is how
   * a gap is closed (negative) or opened (positive). Refused when it would run
   * off either end of the space or drop a register onto another - an array
   * below the gap can reach across it.
   */
  /** The relocated map, or a reason it cannot be applied. */
  const tryRelocate = (addressOf) => {
    const moved = Object.entries(registers).map(([addrText, reg]) => [
      addressOf(Number(addrText)),
      reg,
    ])

    const addresses = moved.map(([addr]) => addr)
    if (addresses.some((addr) => addr < 0 || addr > maxAddr)) {
      return { error: 'That would move a register outside the address space' }
    }

    // Checked on the list, not the map: two registers landing on one address
    // would otherwise collapse into a single key and quietly lose one.
    if (new Set(addresses).size !== addresses.length) {
      return { error: 'That would move a register onto another one' }
    }

    const next = Object.fromEntries(moved)

    if ([...buildAddressMap(next, parameters).values()].some(hasConflict)) {
      return { error: 'That would overlap another register' }
    }

    return { next }
  }

  const relocate = (addressOf, done) => {
    const { next, error } = tryRelocate(addressOf)

    if (error) {
      toast.error(error)
      return false
    }

    setRegisters(next)

    if (currentRegister != null) {
      setCurrentRegister(addressOf(currentRegister))
    }

    toast.success(done)
    return true
  }

  const shiftFrom = (fromAddr, delta, done) =>
    relocate((addr) => (addr >= fromAddr ? addr + delta : addr), done)

  // Gaps collapse to a single row, so typing an address is the only way to
  // land somewhere specific inside a large one.
  const createAtTyped = () => {
    const raw = newAddr.trim().toLowerCase()
    const addr = /^0x[0-9a-f]+$/.test(raw)
      ? parseInt(raw.slice(2), 16)
      : /^\d+$/.test(raw)
        ? Number(raw)
        : NaN

    if (Number.isNaN(addr) || addr < 0 || addr > maxAddr) {
      toast.error(`Address must be between 0 and ${hex(maxAddr, addrWidth)}`)
      return
    }

    if (addr % step !== 0) {
      toast.error(`Address must be ${step}-byte aligned`)
      return
    }

    const owner = addressMap.get(addr)?.[0]
    if (owner) {
      toast.error(`${hex(addr, addrWidth)} is already taken by ${owner.name}`)
      return
    }

    createAt(addr)
    setNewAddr('')
  }

  const sensors = useSensors(useSensor(PointerSensor))

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
  })

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => setActiveId(e.active.id)}
      onDragEnd={(e) => {
        const { active, over } = e

        if (over && over.id !== active.id) {
          // Dragging any row of a multi-selection carries the whole block by
          // the same delta; a lone row keeps the insert-and-shift behaviour.
          if (selected.size > 1 && selected.has(active.id)) {
            dropSelectionAt(over.id, active.id)
          } else {
            moveInsert(active.id, over.id, step, maxAddr)
          }
        }

        setActiveId(null)
      }}
    >
      <div className='mb-2 flex flex-col gap-2'>
        <div className='relative'>
          <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2' />

          <input
            value={query}
            placeholder='Search'
            title='Name, address, description or field name'
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setQuery('')}
            className='border-input h-7 w-full rounded-md border bg-transparent pr-6 pl-7 text-xs outline-none'
          />

          {query && (
            <button
              type='button'
              title='Clear the search'
              onClick={() => setQuery('')}
              className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2'
            >
              <X className='h-3 w-3' />
            </button>
          )}
        </div>

        <div className='flex items-center gap-2'>
          <input
            value={newAddr}
            placeholder='0x0000'
            onChange={(event) => setNewAddr(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && createAtTyped()}
            className='border-input h-7 w-24 rounded-md border bg-transparent px-2 font-mono text-xs outline-none'
          />

          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7'
            onClick={createAtTyped}
          >
            <Plus className='h-3 w-3' />
            Add register
          </Button>

          {/* Never wraps: the panel is narrow and this is the last thing on
              the row, so it would take three lines of it. */}
          <span
            className='text-muted-foreground ml-auto text-xs whitespace-nowrap'
            title={
              needle
                ? `${found} of ${Object.keys(registers).length} registers match`
                : undefined
            }
          >
            {needle
              ? `${found} / ${Object.keys(registers).length}`
              : selected.size > 1
                ? `${selected.size} selected`
                : `${Object.keys(registers).length} registers`}
          </span>
        </div>
      </div>

      <div
        ref={parentRef}
        className='min-h-40 flex-1 overflow-auto'
      >
        <div
          className='relative'
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          <SortableContext
            items={rows.map((row) => row.id)}
            strategy={verticalListSortingStrategy}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]

              return (
                <div
                  key={row.id}
                  className='absolute left-0 w-full'
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.type === 'gap' ? (
                    <GapRow
                      start={row.start}
                      end={row.end}
                      step={step}
                      addrWidth={addrWidth}
                      onCreate={() => createAt(row.start)}
                      onClear={() => {
                        setSelected(new Set())
                        setAnchor(null)
                      }}
                      onClose={
                        // The final gap runs to the end of the space: there is
                        // nothing above it to pull down.
                        virtualRow.index < rows.length - 1
                          ? () =>
                              shiftFrom(
                                row.end + step,
                                -(row.end - row.start + step),
                                `Closed the gap at ${hex(row.start, addrWidth)}`
                              )
                          : undefined
                      }
                      onResize={
                        virtualRow.index < rows.length - 1
                          ? (words) => {
                              const was = (row.end - row.start) / step + 1
                              shiftFrom(
                                row.end + step,
                                (words - was) * step,
                                `Reserved ${words} word(s) at ${hex(row.start, addrWidth)}`
                              )
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <RegisterItem
                      addr={row.addr}
                      addrWidth={addrWidth}
                      step={step}
                      maxAddr={maxAddr}
                      claims={addressMap.get(row.addr)}
                      issues={issuesByAddr.get(row.addr)}
                      hoveredReg={hoveredReg}
                      onHoverReg={setHoveredReg}
                      dragDisabled={Boolean(needle)}
                      isSelected={selected.has(row.addr)}
                      onSelect={selectRow}
                      onInsertBefore={() =>
                        shiftFrom(
                          row.addr,
                          step,
                          `Inserted a free word at ${hex(row.addr, addrWidth)}`
                        )
                      }
                      isDragging={row.addr === activeId}
                    />
                  )}
                </div>
              )
            })}
          </SortableContext>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeId != null && activeRegisterName && (
          <RegisterDragOverlay
            addr={activeId}
            addrWidth={addrWidth}
            reg={activeRegisterName}
          />
        )}
      </DragOverlay>
    </DndContext>
  )
}
