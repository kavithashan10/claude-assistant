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
  thisProject: number
  prompts: number
  project: string
  stats: string[]
  sources: string[]
  notes: string[]
  suggestions: Suggestion[]
}

declare module 'claude-code' {
  interface PluginState {
    'suggestion-box-pane': {
      report: Shaped<Report | null>
      tab: Shaped<'suggest' | 'learn'>
      open: Shaped<string>
      dismissed: Shaped<string[]>
      busy: Shaped<boolean>
    }
  }
}
