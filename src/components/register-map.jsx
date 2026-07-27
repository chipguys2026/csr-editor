import React, { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { deleteRegister } from '@/lib/delete-register'

// Row actions stay hidden until the row is hovered or the button is focused.
const rowActionClass =
  'hover:bg-accent ml-auto shrink-0 cursor-pointer rounded-sm p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none'
import { hex } from '@/lib/number-formating'
import { formatArrayRange } from '@/lib/register'
import { buildAddressMap, hasConflict } from '@/lib/address-map'
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

export const RegisterItem = ({ addr, isDragging, addrWidth, claims }) => {
  const reg = useRegisterStore((s) => s.registers[addr])
  const createRegister = useRegisterStore((s) => s.createRegister)

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

  const isEmpty = !reg && !instance

  // Clicking a free slot leaves it reserved; creating one is the explicit +.
  const onSelect = () => {
    if (isEmpty) return
    setCurrentRegister(instance ? instance.regAddr : addr)
  }

  const onCreate = (event) => {
    event.stopPropagation()
    createRegister(addr)
    setCurrentRegister(addr)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group grid h-9 grid-cols-[48px_1fr] items-center gap-2',
        isDragging && 'opacity-0'
      )}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        className={cn(
          'text-muted-foreground cursor-grab text-sm',
          !reg && 'cursor-default opacity-50'
        )}
      >
        {hex(addr, addrWidth)}
      </span>

      <div
        className={cn(
          'flex h-full grow items-center gap-2 border p-2',
          isEmpty ? 'text-muted-foreground' : 'cursor-pointer',
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
          {reg?.name ??
            (instance ? `${instance.name}[${instance.index}]` : 'Reserved')}
        </span>

        {reg?.array && (
          <span
            className='bg-muted text-muted-foreground shrink-0 rounded-sm px-1 font-mono text-xs'
            title={`${formatArrayRange(reg.array)}, stride ${reg.array.stride} bytes`}
          >
            ×{reg.array.count}
          </span>
        )}

        {isEmpty && (
          <button
            type='button'
            title={`Create a register at ${hex(addr, addrWidth)}`}
            onClick={onCreate}
            className={rowActionClass}
          >
            <Plus className='h-3.5 w-3.5' />
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
            className={cn(rowActionClass, 'text-destructive')}
          >
            <Trash2 className='h-3.5 w-3.5' />
          </button>
        )}
      </div>
    </div>
  )
}

export const RegisterDragOverlay = ({ addr, addrWidth, reg }) => {
  return (
    <div className='grid h-9 grid-cols-[48px_1fr] items-center gap-2'>
      <span className='text-muted-foreground cursor-grabbing text-sm'>
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

  const { addrWidth, dataWidth, parameters } = useParamStore()
  const moveInsert = useRegisterStore((s) => s.moveInsert)
  const registers = useRegisterStore((s) => s.registers)
  const activeRegisterName = useRegisterStore((s) =>
    activeId != null ? s.registers[activeId] : null
  )

  const addressMap = buildAddressMap(registers, parameters)

  const step = dataWidth / 8
  const slotCount = 2 ** addrWidth / step
  const maxAddr = (slotCount - 1) * step

  const slots = Array.from({ length: slotCount }, (_, i) => i * step)

  const sensors = useSensors(useSensor(PointerSensor))

  const rowVirtualizer = useVirtualizer({
    count: slots.length,
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
      <div
        ref={parentRef}
        className='h-120 overflow-auto'
      >
        <div
          className='relative'
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          <SortableContext
            items={slots}
            strategy={verticalListSortingStrategy}
          >
            {rowVirtualizer.getVirtualItems().map((row) => {
              const addr = slots[row.index]

              return (
                <div
                  key={addr}
                  className='absolute left-0 w-full'
                  style={{
                    height: row.size,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <RegisterItem
                    addr={addr}
                    addrWidth={addrWidth}
                    step={step}
                    maxAddr={maxAddr}
                    claims={addressMap.get(addr)}
                    isDragging={addr === activeId}
                  />
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
