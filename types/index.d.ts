export type Suggestion = {
  id: string
  kind: string
  title: string
  why: string
  evidence: string[]
  make: string
  prompt: string
  score: number
}

export type Report = {
  generatedAt: number
  sessions: number
  prompts: number
  sources: string[]
  notes: string[]
  suggestions: Suggestion[]
}

declare module 'claude-code' {
  interface PluginState {
    'suggestion-box': {
      report: Shaped<Report | null>
      tab: Shaped<'suggest' | 'learn'>
      open: Shaped<string>
      dismissed: Shaped<string[]>
      busy: Shaped<boolean>
    }
  }
}
