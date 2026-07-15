// Stub for @ant/computer-use-input (Anthropic internal package, not publicly available)

export type ComputerUseInput = unknown
export type ComputerUseInputAPI = {
  key: (_key: string) => void
  keys: (_keys: string[]) => void
  mouseMove: (_x: number, _y: number) => void
  mouseDown: (_button: number) => void
  mouseUp: (_button: number) => void
  scroll: (_dx: number, _dy: number) => void
  getFrontmostApp: () => unknown
}
