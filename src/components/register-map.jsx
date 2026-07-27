import React, { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { deleteRegister } from '@/lib/delete-register'
import { hex } from '@/lib/number-formating'
import { formatArrayRange } from '@/lib/register'
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
  addrWidth,
  claims,
  hoveredReg,
  onHoverReg,
}) => {
  const reg = useRegisterStore((s) => s.registers[addr])

  const setCurrentRegister = useCurrentRegisterStore(
    (s) => s.setCurrentRegister
  )

  const sortable = useSortable({
    id: addr,
    disabled: !reg,
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

  const onSelect = () => setCurrentRegister(instance ? instance.regAddr : addr)

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
          !reg && 'cursor-default opacity-50'
        )}
      >
        {hex(addr, addrWidth)}
      </span>

      <div
        className={cn(
          'flex h-full grow cursor-pointer items-center gap-2 border p-2',
          inHoveredBank && 'border-foreground/40 bg-muted-foreground/25',
          conflict && 'border-destructive text-destructive',
          instance && 'text-muted-foreground border-dashed'
        )}
        title={
          conflict
            ? `Address claimed by ${[...new Set(claims.map((entry) => entry.name))].join(' and ')}`
            : undefined
        }
      >
        <span className='truncate'>
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

        {reg && (
          <button
            type='button'
            title={`Delete ${reg.name}`}
            onClick={(event) => {
              event.stopPropagation()
              deleteRegister(addr)
            }}
            className={cn(rowActionClass, 'text-destructive')}
          >
            <Trash2 className='h-3.5 w-3.5' />
          </button>
        )}
      </div>
    </div>
  )
}

/** A run of unused addresses, collapsed to one row and open as a drop target. */
const GapRow = ({ start, end, step, addrWidth, onCreate }) => {
  const words = (end - start) / step + 1

  const { setNodeRef } = useSortable({
    id: start,
    // Cannot be picked up, but a register can be dropped into it.
    disabled: { draggable: true, droppable: false },
  })

  return (
    <div
      ref={setNodeRef}
      className='group grid h-9 grid-cols-[auto_1fr] items-center gap-2'
    >
      <span className='text-muted-foreground font-mono text-sm whitespace-nowrap opacity-50'>
        {hex(start, addrWidth)}
      </span>

      <div className='text-muted-foreground flex h-full grow items-center gap-2 border border-dashed p-2'>
        <span className='truncate'>
          {words === 1
            ? 'Reserved'
            : `Reserved · ${words.toLocaleString()} words to ${hex(end, addrWidth)}`}
        </span>

        <button
          type='button'
          title={`Create a register at ${hex(start, addrWidth)}`}
          onClick={onCreate}
          className={rowActionClass}
        >
          <Plus className='h-3.5 w-3.5' />
        </button>
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
      <div className='flex h-full grow items-center border p-2'>
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

  const { addrWidth, dataWidth, parameters } = useParamStore()
  const moveInsert = useRegisterStore((s) => s.moveInsert)
  const registers = useRegisterStore((s) => s.registers)
  const activeRegisterName = useRegisterStore((s) =>
    activeId != null ? s.registers[activeId] : null
  )

  const createRegister = useRegisterStore((s) => s.createRegister)
  const setCurrentRegister = useCurrentRegisterStore((s) => s.setCurrentRegister)

  const addressMap = buildAddressMap(registers, parameters)

  const step = dataWidth / 8
  // 2 ** addrWidth overflows past 53 bits, so cap the space at what a JS number
  // still indexes exactly. Addresses that high are unreachable in practice.
  const maxAddr = Math.min(2 ** addrWidth, Number.MAX_SAFE_INTEGER + 1) - step

  const rows = buildRows(addressMap, step, maxAddr)

  const createAt = (addr) => {
    createRegister(addr)
    setCurrentRegister(addr)
  }

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
        if (over) {
          moveInsert(active.id, over.id, step, maxAddr)
        }
        setActiveId(null)
      }}
    >
      <div className='mb-2 flex items-center gap-2'>
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

        <span className='text-muted-foreground ml-auto text-xs'>
          {Object.keys(registers).length} registers
        </span>
      </div>

      <div
        ref={parentRef}
        className='h-120 overflow-auto'
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
                    />
                  ) : (
                    <RegisterItem
                      addr={row.addr}
                      addrWidth={addrWidth}
                      step={step}
                      maxAddr={maxAddr}
                      claims={addressMap.get(row.addr)}
                      hoveredReg={hoveredReg}
                      onHoverReg={setHoveredReg}
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
