import { accessColorMap } from '@/lib/access-types'
import { cn } from '@/lib/utils'
import { normalizeRegister } from '@/lib/register'

import { Fragment } from 'react'

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
}) => (
  <g>
    {fields.map((field, i) => {
      const { msb, lsb } = field.bitRange

      const x = (nbBitCell - 1 - msb) * bitCellWidth + offsetX
      const width = (msb - lsb + 1) * bitCellWidth
      const isHighlighted = highlightLsb === lsb
      const isDimmed = highlightLsb != null && !isHighlighted

      return (
        <rect
          key={`fieldRectange${i}`}
          x={x}
          y={offsetY}
          width={width}
          height={registerHeight}
          className={cn(
            field.name === 'RESERVED' ? colorMap['RSVD'] : colorMap[field.type],
            isDimmed && 'opacity-30',
            isHighlighted && 'stroke-foreground'
          )}
          stroke={isHighlighted ? undefined : 'none'}
          strokeWidth={isHighlighted ? 2 : undefined}
          onMouseEnter={() => onHighlight?.(lsb)}
          onMouseLeave={() => onHighlight?.(null)}
        />
      )
    })}
  </g>
)

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
}) => {
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

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      strokeWidth={1}
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
    </svg>
  )
}
