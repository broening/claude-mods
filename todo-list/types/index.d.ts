export type Task = {
  id: string
  text: string
  done: boolean
  createdAt: number
  doneAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'todo-list': {
      tasks: Task[]
      activeId: string | null
      auto: boolean
      editingId: string | null
      draft: string
    }
  }
}
