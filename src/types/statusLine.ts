
import type { VimMode } from './textInputTypes.js'

type StatusLineRateLimitWindow = {
  used_percentage: number
  resets_at: number
}

export type StatusLineCommandInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string

  session_name?: string
  model: {
    id: string
    display_name: string
  }
  workspace: {
    current_dir: string
    project_dir: string
    added_dirs: string[]
  }
  version: string
  output_style: {
    name: string
  }
  cost: {
    total_cost_usd: number
    total_duration_ms: number
    total_api_duration_ms: number
    total_lines_added: number
    total_lines_removed: number
  }
  context_window: {
    total_input_tokens: number
    total_output_tokens: number
    total_tokens_are_estimated?: boolean
    context_window_size: number
    current_usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens: number
      cache_read_input_tokens: number
      is_estimated?: boolean
    } | null
    used_percentage: number | null
    remaining_percentage: number | null
  }
  exceeds_200k_tokens: boolean
  rate_limits?: {
    five_hour?: StatusLineRateLimitWindow
    seven_day?: StatusLineRateLimitWindow
  }
  vim?: {
    mode: VimMode
  }
  agent?: {
    name: string
  }
  remote?: {
    session_id: string
  }
  worktree?: {
    name: string
    path: string
    branch: string | undefined
    original_cwd: string
    original_branch: string | undefined
  }
}
