import { createContext, useContext } from 'react'

export const ContentWidthContext = createContext<number | null>(null)

/**
 * 返回当前布局容器承诺给子组件的真实内容宽度；没有容器约束时使用回退值。
 */
export function useContentWidth(fallback: number): number {
  return useContext(ContentWidthContext) ?? fallback
}
