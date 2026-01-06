import React, { useEffect, useRef, useState } from 'react'
import { hex } from '@/lib/number-formating'
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

export const RegisterItem = ({ addr, isDragging, addrWidth }) => {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'grid h-9 grid-cols-[48px_1fr] items-center gap-2',
        isDragging && 'opacity-0'
      )}
      onClick={() => {
        if (!reg) {
          createRegister(addr)
        }
        setCurrentRegister(addr)
      }}
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        className={cn(
          'text-muted-foreground cursor-grab text-sm',
          !reg && 'cursor-pointer opacity-50'
        )}
      >
        {hex(addr, addrWidth)}
      </span>

      <div className='flex h-full grow cursor-pointer items-center border p-2'>
        {reg?.name ?? 'Reserved'}
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

  const { addrWidth, dataWidth } = useParamStore()
  const moveInsert = useRegisterStore((s) => s.moveInsert)
  const activeRegisterName = useRegisterStore((s) =>
    activeId != null ? s.registers[activeId] : null
  )

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
