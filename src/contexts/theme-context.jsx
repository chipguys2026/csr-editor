import { createContext } from 'react'

export const initialState = {
  theme: 'system',
  setTheme: () => null,
}

const ThemeProviderContext = createContext(initialState)

export default ThemeProviderContext
