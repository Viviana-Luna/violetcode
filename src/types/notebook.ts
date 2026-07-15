
export type NotebookCellType = 'code' | 'markdown'

export type NotebookCellOutput =
  | {
      output_type: 'stream'
      name?: string
      text: string | string[]
    }
  | {
      output_type: 'execute_result' | 'display_data'
      data?: {
        'text/plain'?: string | string[]
        [mimeType: string]: unknown
      }
      metadata?: Record<string, unknown>
      execution_count?: number | null
    }
  | {
      output_type: 'error'
      ename: string
      evalue: string
      traceback: string[]
    }

export type NotebookCell = {
  cell_type: NotebookCellType
  id?: string
  source: string | string[]
  metadata: Record<string, unknown>
  execution_count?: number | null
  outputs?: NotebookCellOutput[]
}

export type NotebookContent = {
  cells: NotebookCell[]
  metadata: {
    language_info?: { name: string }
    [key: string]: unknown
  }
  nbformat: number
  nbformat_minor: number
}

export type NotebookOutputImage = {
  image_data: string
  media_type: 'image/png' | 'image/jpeg'
}

export type NotebookCellSourceOutput = {
  output_type: NotebookCellOutput['output_type']
  text: string
  image?: NotebookOutputImage | undefined
}

export type NotebookCellSource = {
  cell_id: string
  cellType: NotebookCellType
  source: string
  language?: string
  execution_count?: number | undefined
  outputs?: NotebookCellSourceOutput[]
}
