import { accessColorMap } from '@/lib/access-types'
import { cn } from '@/lib/utils'
import { normalizeRegister } from '@/lib/register'

import { Fragment, useEffect, useRef, useState } from 'react'

// Helpers
const estimateMonoTextWidth = (text, fontSize) => text.length * fontSize * 0.6
const calcBitCellCenterX = (index, nbBitCell, bitCellWidth, offset) =>
  (nbBitCell - 1 - index) * bitCellWidth + bitCellWidth / 2 + offset
const calcFieldCenterX = (msb, lsb, nbBitCell, bitCellWidth, offset) =>
  ((nbBitCell - 1 - msb) * bitCellWidth +
    (nbBitCell - 1 - lsb) * bitCellWidth +
    bitCellWidth) /
    2 +
  offset

const FieldRectanges = ({
  fields,
  nbBitCell,
  registerHeight,
  bitCellWidth,
  offsetX,
  offsetY,
  colorMap,
  highlightLsb,
  onHighlight,
  dragLsb,
  dropLsb,
  onDragStart,
}) => (
  <g>
    {fields.map((field, i) => {
      const { msb, lsb } = field.bitRange

      const x = (nbBitCell - 1 - msb) * bitCellWidth + offsetX
      const width = (msb - lsb + 1) * bitCellWidth
      const isHighlighted = highlightLsb === lsb
      const isDimmed = highlightLsb != null && !isHighlighted
      // Reserved spans are gaps, not fields: nothing to pick up or drop onto.
      const isDraggable = Boolean(onDragStart) && field.name !== 'RESERVED'
      const isSource = dragLsb === lsb
      const isTarget = dropLsb === lsb && !isSource

      return (
        <rect
          key={`fieldRectange${i}`}
          x={x}
          y={offsetY}
          width={width}
          height={registerHeight}
          className={cn(
            field.name === 'RESERVED' ? colorMap['RSVD'] : colorMap[field.type],
            isDimmed && !isTarget && 'opacity-30',
            (isHighlighted || isTarget) && 'stroke-foreground',
            isSource && 'opacity-25',
            isDraggable && (dragLsb == null ? 'cursor-grab' : 'cursor-grabbing')
          )}
          stroke={isHighlighted || isTarget ? undefined : 'none'}
          strokeWidth={isHighlighted || isTarget ? 2 : undefined}
          onMouseEnter={() => onHighlight?.(lsb)}
          onMouseLeave={() => onHighlight?.(null)}
          // preventDefault: a bare mousedown starts a text selection, which
          // swallows the drag and leaves the page highlighted instead.
          onMouseDown={
            isDraggable
              ? (event) => {
                  event.preventDefault()
                  onDragStart(lsb)
                }
              : undefined
          }
        />
      )
    })}
  </g>
)

/** A translucent copy of the field being dragged, tracking the cursor. */
const DragGhost = ({ field, x, registerHeight, bitCellWidth, offsetY, colorMap }) => {
  const width =
    (field.bitRange.msb - field.bitRange.lsb + 1) * bitCellWidth

  return (
    <rect
      x={x - width / 2}
      y={offsetY}
      width={width}
      height={registerHeight}
      className={cn(colorMap[field.type], 'stroke-foreground pointer-events-none')}
      strokeWidth={2}
      opacity={0.85}
    />
  )
}

const FieldDividers = ({
  fields,
  nbBitCell,
  registerHeight,
  bitCellWidth,
  offsetX,
  offsetY,
}) => (
  <g>
    {fields.map((field, i) => {
      const { msb } = field.bitRange

      if (msb == nbBitCell - 1) return null

      const x = (nbBitCell - 1 - msb) * bitCellWidth + offsetX

      return (
        <line
          key={`fieldDevider${i}`}
          x1={x}
          y1={offsetY}
          x2={x}
          y2={offsetY + registerHeight}
          className='stroke-foreground'
        />
      )
    })}
  </g>
)

const FieldAnnotations = ({
  fields,
  nbBitCell,
  bitCellWidth,
  firstLineHeight,
  fieldNameX,
  gap,
  fieldNameSize,
  offsetX,
  offsetY,
  highlightLsb,
  onHighlight,
}) => (
  <g>
    {fields.map((field, i) => {
      const { msb, lsb } = field.bitRange
      const isHighlighted = highlightLsb === lsb
      const isDimmed = highlightLsb != null && !isHighlighted

      const fieldCenterX = calcFieldCenterX(
        msb,
        lsb,
        nbBitCell,
        bitCellWidth,
        offsetX
      )
      const fieldBottomY = offsetY
      const labelY = firstLineHeight + i * gap + offsetY

      return (
        <g
          key={`fieldAnnotation${i}`}
          className={cn(isDimmed && 'opacity-30')}
          onMouseEnter={() => onHighlight?.(lsb)}
          onMouseLeave={() => onHighlight?.(null)}
        >
          <path
            d={`M ${fieldCenterX} ${fieldBottomY} L ${fieldCenterX} ${labelY} L ${fieldNameX - 2} ${labelY}`}
            className='stroke-foreground'
            strokeWidth={isHighlighted ? 2 : undefined}
            fill='none'
          />

          <text
            x={fieldNameX}
            y={labelY}
            className='fill-foreground'
            fontSize={fieldNameSize}
            fontFamily='monospace'
            fontWeight={isHighlighted ? 'bold' : undefined}
            textAnchor='start'
            dominantBaseline='middle'
          >
            {field.name}
          </text>
        </g>
      )
    })}
  </g>
)

const BitCellIndexes = ({
  fields,
  nbBitCell,
  bitCellWidth,
  indexLineHeight,
  indexSize,
  offsetX,
  offsetY,
}) => (
  <g>
    {fields.map((field, i) => {
      const { msb, lsb } = field.bitRange

      return msb == lsb ? (
        <text
          key={`bitCellIndex${i}`}
          x={calcBitCellCenterX(msb, nbBitCell, bitCellWidth, offsetX)}
          y={indexLineHeight / 2 + offsetY}
          className='fill-foreground'
          fontSize={indexSize}
          textAnchor='middle'
          dominantBaseline='middle'
        >
          {msb}
        </text>
      ) : (
        <Fragment key={`bitCellIndex${i}`}>
          <text
            x={calcBitCellCenterX(msb, nbBitCell, bitCellWidth, offsetX)}
            y={indexLineHeight / 2 + offsetY}
            className='fill-foreground'
            fontSize={indexSize}
            textAnchor='middle'
            dominantBaseline='middle'
          >
            {msb}
          </text>

          <text
            x={calcBitCellCenterX(lsb, nbBitCell, bitCellWidth, offsetX)}
            y={indexLineHeight / 2 + offsetY}
            className='fill-foreground'
            fontSize={indexSize}
            textAnchor='middle'
            dominantBaseline='middle'
          >
            {lsb}
          </text>
        </Fragment>
      )
    })}
  </g>
)

const RegisterFrame = ({
  registerWidth,
  registerHeight,
  nbBitCell,
  bitCellWidth,
  dividerHeight,
  offsetX,
  offsetY,
}) => {
  const upperDividerY1 = offsetY
  const upperDividerY2 = offsetY + dividerHeight
  const lowerDividerY1 = offsetY + registerHeight - dividerHeight
  const lowerDividerY2 = offsetY + registerHeight
  return (
    <>
      <g>
        {Array.from({ length: nbBitCell - 1 }).map((_, i) => {
          const x = (i + 1) * bitCellWidth + offsetX
          return (
            <g key={`bitCellDivider${i}`}>
              <line
                x1={x}
                y1={upperDividerY1}
                x2={x}
                y2={upperDividerY2}
                className='stroke-foreground'
              />

              <line
                x1={x}
                y1={lowerDividerY1}
                x2={x}
                y2={lowerDividerY2}
                className='stroke-foreground'
              />
            </g>
          )
        })}
      </g>
      <rect
        x={offsetX}
        y={offsetY}
        width={registerWidth}
        height={registerHeight}
        className='stroke-foreground'
        fill='none'
      />
    </>
  )
}

export const RegisterDiagram = ({
  fields,
  dataWidth,
  options,
  highlightLsb = null,
  onHighlight,
  onMoveField,
}) => {
  // Press a block and it follows the cursor until release. SVG elements do not
  // honour the HTML draggable attribute, and tracking on the window rather than
  // on the blocks means a fast drag or a release off the diagram still lands.
  const svgRef = useRef(null)
  const [drag, setDrag] = useState(null)
  // Geometry the window listeners need, kept fresh without re-binding them.
  const geometryRef = useRef(null)

  const colorMap = {
    ...accessColorMap,
    ...(options?.colorMap ?? {}),
  }
  const registerWidth = options?.registerWidth ?? 768
  const registerHeight = options?.registerHeight ?? 36
  const padding = options?.padding ?? 4
  const indexLineHeight = 24
  const indexSize = 12
  const firstIndicatorLineHeight = 24
  const indicatorGap = 24
  const fieldNameSize = 16

  const bitCellWidth = registerWidth / dataWidth

  const maxFieldNameWidth = Math.max(
    0,
    ...fields.map((f) => estimateMonoTextWidth(f.name, fieldNameSize))
  )

  const svgWidth = padding * 2 + registerWidth + maxFieldNameWidth
  const svgHeight =
    padding * 2 +
    indexLineHeight +
    registerHeight +
    firstIndicatorLineHeight +
    fields.length * indicatorGap

  const fullFields = normalizeRegister(fields)
  // Label rows follow bit position, not the order fields were authored in: a
  // leader line can only cross one from a row above it when the two are out of
  // order, so sorting removes every crossing.
  const annotationFields = [...fields].sort(
    (a, b) => a.bitRange.lsb - b.bitRange.lsb
  )

  // Refreshed after each render rather than during it, so the window listeners
  // always read current geometry without being re-bound.
  useEffect(() => {
    geometryRef.current = {
      spans: fullFields,
      svgWidth,
      padding,
      bitCellWidth,
      dataWidth,
      onMoveField,
    }
  })

  // Only the picked-up field matters to the listeners; its position lives in
  // state purely so the ghost re-renders.
  const draggingLsb = drag?.lsb ?? null

  useEffect(() => {
    if (draggingLsb == null) return undefined

    const svgX = (clientX) => {
      const bounds = svgRef.current.getBoundingClientRect()
      return (
        (clientX - bounds.left) *
        (geometryRef.current.svgWidth / bounds.width)
      )
    }

    // Which bit sits under the cursor: bit 0 is drawn at the right edge.
    const bitAt = (x) => {
      const { padding: pad, bitCellWidth: cell, dataWidth: bits } =
        geometryRef.current
      return bits - 1 - Math.floor((x - pad) / cell)
    }

    // The span it falls in, which may be a reserved gap rather than a field.
    const spanAt = (bit) =>
      geometryRef.current.spans.find(
        (span) => bit >= span.bitRange.lsb && bit <= span.bitRange.msb
      )

    const onMove = (event) =>
      setDrag((current) => {
        if (!current) return current

        const x = svgX(event.clientX)
        return {
          ...current,
          x,
          dropLsb: spanAt(bitAt(x))?.bitRange.lsb ?? null,
        }
      })

    const onUp = (event) => {
      const bit = bitAt(svgX(event.clientX))
      const span = spanAt(bit)

      if (span && span.bitRange.lsb !== draggingLsb) {
        geometryRef.current.onMoveField(draggingLsb, bit)
      }

      setDrag(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [draggingLsb])

  const draggedField = drag && fields.find((f) => f.bitRange.lsb === drag.lsb)

  return (
    <svg
      ref={svgRef}
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      strokeWidth={1}
      // select-none stops a drag across blocks from painting the labels blue;
      // onDragStart blocks the browser's own element drag.
      className={cn(onMoveField && 'select-none')}
      onDragStart={(event) => event.preventDefault()}
    >
      <BitCellIndexes
        fields={fullFields}
        nbBitCell={dataWidth}
        bitCellWidth={bitCellWidth}
        indexLineHeight={indexLineHeight}
        indexSize={indexSize}
        offsetX={padding}
        offsetY={padding}
      />
      <FieldRectanges
        fields={fullFields}
        nbBitCell={dataWidth}
        registerHeight={registerHeight}
        bitCellWidth={bitCellWidth}
        offsetX={padding}
        offsetY={padding + indexLineHeight}
        colorMap={colorMap}
        highlightLsb={highlightLsb}
        onHighlight={onHighlight}
        dragLsb={drag?.lsb ?? null}
        dropLsb={drag?.dropLsb ?? null}
        onDragStart={
          onMoveField
            ? (lsb) => setDrag({ lsb, x: null, dropLsb: lsb })
            : undefined
        }
      />
      <FieldDividers
        fields={fullFields}
        nbBitCell={dataWidth}
        registerHeight={registerHeight}
        bitCellWidth={bitCellWidth}
        offsetX={padding}
        offsetY={padding + indexLineHeight}
      />
      <FieldAnnotations
        fields={annotationFields}
        nbBitCell={dataWidth}
        bitCellWidth={bitCellWidth}
        firstLineHeight={firstIndicatorLineHeight}
        gap={indicatorGap}
        fieldNameX={registerWidth + padding}
        fieldNameSize={fieldNameSize}
        offsetX={padding}
        offsetY={padding + indexLineHeight + registerHeight + 2}
        highlightLsb={highlightLsb}
        onHighlight={onHighlight}
      />
      <RegisterFrame
        registerWidth={registerWidth}
        registerHeight={registerHeight}
        bitCellWidth={bitCellWidth}
        offsetX={padding}
        offsetY={padding + indexLineHeight}
        nbBitCell={dataWidth}
        dividerHeight={4} // TODO: Hardcode
      />

      {/* Drawn last so it rides over the register while it follows the cursor. */}
      {draggedField && (
        <DragGhost
          field={draggedField}
          x={
            drag.x ??
            calcFieldCenterX(
              draggedField.bitRange.msb,
              draggedField.bitRange.lsb,
              dataWidth,
              bitCellWidth,
              padding
            )
          }
          registerHeight={registerHeight}
          bitCellWidth={bitCellWidth}
          offsetY={padding + indexLineHeight}
          colorMap={colorMap}
        />
      )}
    </svg>
  )
}
