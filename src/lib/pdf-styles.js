import { createTw } from '@react-pdf/tailwind'
import { Font } from '@react-pdf/renderer'
import { accessColorMap } from './access-types.js'

// Static instances of the UI font preserve weight and style in the PDF renderer.
// Vite emits asset URLs; the native CLI uses the same files from disk.
const fontSource = (url) =>
  url.protocol === 'file:'
    ? decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, '$1')
    : url.href

Font.register({
  family: 'Plus Jakarta Sans',
  fonts: [
    {
      src: fontSource(
        new URL('../assets/fonts/pdf/PlusJakartaSans-Regular.ttf', import.meta.url)
      ),
      fontWeight: 400,
    },
    {
      src: fontSource(
        new URL('../assets/fonts/pdf/PlusJakartaSans-Bold.ttf', import.meta.url)
      ),
      fontWeight: 700,
    },
    {
      src: fontSource(
        new URL('../assets/fonts/pdf/PlusJakartaSans-Italic.ttf', import.meta.url)
      ),
      fontWeight: 400,
      fontStyle: 'italic',
    },
    {
      src: fontSource(
        new URL('../assets/fonts/pdf/PlusJakartaSans-BoldItalic.ttf', import.meta.url)
      ),
      fontWeight: 700,
      fontStyle: 'italic',
    },
  ],
})

export const tw = createTw({
  fontFamily: { sans: ['Plus Jakarta Sans'], mono: ['Courier'] },
})

// PDF uses the light background utility from the same map as the editor.
// SVG fill and theme/state variants are not supported by the converter.
export const accessPdfStyleOf = (access, reserved = false) => {
  const classes =
    !reserved && Object.hasOwn(accessColorMap, access)
      ? accessColorMap[access]
      : accessColorMap.RSVD
  return tw(
    classes
      .split(/\s+/)
      .filter((name) => name.startsWith('bg-'))
      .join(' ')
  )
}
