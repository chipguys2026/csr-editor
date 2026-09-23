import packageInfo from '../../package.json'
import { paramsSchema } from '@/schemas/params-schema'
import { useCurrentRegisterStore } from '@/store/current-register-store'
import {
  parseLayout,
  SIDEBAR_KEYS,
  useLayoutStore,
} from '@/store/layout-store'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'

/**
 * The project file: what Save writes, Open reads and autosave keeps up to
 * date. One place, so the three cannot disagree about what a document is.
 */

const JSON_TYPES = [
  {
    description: 'CSR document',
    accept: { 'application/json': ['.json'] },
  },
]

/**
 * Whether the browser can keep hold of a file on disk and write back to it.
 * Chromium can; elsewhere a document is uploaded and downloaded instead, and
 * there is nothing to autosave into.
 */
export const canLinkFiles =
  typeof window !== 'undefined' && 'showOpenFilePicker' in window

/** The document as it stands, without the metadata that changes each save. */
const documentOf = () => {
  const {
    dataWidth,
    addrWidth,
    interface: csrInterface,
    moduleName,
    parameters,
    headerPrefix,
    registeredReadback,
    sdcTarget,
  } = useParamStore.getState()
  const layout = useLayoutStore.getState()

  return {
    params: {
      dataWidth,
      addrWidth,
      interface: csrInterface,
      moduleName,
      parameters,
      headerPrefix,
      registeredReadback,
      sdcTarget,
    },
    registers: useRegisterStore.getState().registers,
    // How the document was laid out when saved, so it opens the same way.
    // Rounded: a tenth of a percent is finer than a drag can place it.
    layout: Object.fromEntries(
      SIDEBAR_KEYS.map((key) => [key, Math.round(layout[key] * 10) / 10])
    ),
  }
}

/**
 * A fingerprint of the document's content. Autosave compares it with the one
 * last written, so opening a file, or a store settling on the value it already
 * had, does not write the file again.
 */
export const documentKey = () => JSON.stringify(documentOf())

/** The file's text, as Save and autosave write it. */
export const serializeProject = () =>
  JSON.stringify(
    {
      metadata: {
        tool: { name: packageInfo.name, version: packageInfo.version },
        generatedAt: new Date().toISOString(),
      },
      ...documentOf(),
    },
    null,
    2
  )

/** Load a file's text into the editor. Throws when it is not a document. */
export const applyProject = (text) => {
  const payload = JSON.parse(text)
  const params = payload?.params
  const registers = payload?.registers

  if (!params || !registers) {
    throw new Error('Invalid JSON shape')
  }

  // Anything the file predates falls back to the schema default rather than
  // to undefined, so an older document still opens.
  useParamStore.getState().setParams(
    paramsSchema.parse({
      dataWidth: Number(params.dataWidth),
      addrWidth: Number(params.addrWidth),
      interface: params.interface ?? 'Native',
      moduleName: params.moduleName ?? 'CSR',
      parameters: params.parameters ?? [],
      headerPrefix: params.headerPrefix ?? '',
      registeredReadback: Boolean(params.registeredReadback),
      sdcTarget: params.sdcTarget ?? 'synopsys',
    })
  )
  useRegisterStore.getState().setRegisters(registers)
  // A file saved before layout was kept leaves the current widths alone.
  useLayoutStore.getState().setLayout(parseLayout(payload.layout))

  const addrs = Object.keys(registers).map(Number)
  const first = addrs.length ? Math.min(...addrs) : null
  useCurrentRegisterStore
    .getState()
    .setCurrentRegister(first != null && !Number.isNaN(first) ? first : null)
}

/**
 * Ask to keep writing to a file. Only granted from a click, so it is asked
 * when the file is opened rather than at the first autosave.
 */
export const requestWriteAccess = async (handle) => {
  const options = { mode: 'readwrite' }

  if ((await handle.queryPermission?.(options)) === 'granted') return true
  return (await handle.requestPermission?.(options)) !== 'denied'
}

export const writeToHandle = async (handle, text) => {
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
}

/** Pick a document to open, keeping its handle. Null when cancelled. */
export const pickFileToOpen = async () => {
  try {
    const [handle] = await window.showOpenFilePicker({ types: JSON_TYPES })
    return handle
  } catch (error) {
    if (error?.name === 'AbortError') return null
    throw error
  }
}

/** Pick where to save, keeping the handle. Null when cancelled. */
export const pickFileToSave = async (suggestedName) => {
  try {
    return await window.showSaveFilePicker({ suggestedName, types: JSON_TYPES })
  } catch (error) {
    if (error?.name === 'AbortError') return null
    throw error
  }
}

/** Where there is no handle to write through, Save downloads a copy. */
export const downloadProject = (filename, text) => {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
