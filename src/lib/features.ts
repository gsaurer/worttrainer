import { createContext, useContext } from 'react'

const none: readonly string[] = []
const FeaturesContext = createContext<readonly string[]>(none)

export const FeaturesProvider = FeaturesContext.Provider
export const noFeatures = none

export function useFeature(name: string): boolean {
  return useContext(FeaturesContext).includes(name)
}
