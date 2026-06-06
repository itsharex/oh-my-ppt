import type { ReactNode } from 'react'
import { workbenchPanelClass } from './styles'

export function WorkbenchPanelShell({
  title,
  children
}: {
  title: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <aside className={workbenchPanelClass}>
      <div className="relative mx-2.5 mt-2.5 overflow-hidden rounded-[1.35rem] border border-[#e1d6c4]/72 bg-[#fffaf1]/78 px-3 pb-2.5 pt-3 shadow-[0_4px_12px_rgba(77,61,43,0.06)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7a875f]">
          {title}
        </div>
      </div>
      <div className="flex-1 space-y-2.5 overflow-y-auto px-2.5 py-2.5">{children}</div>
    </aside>
  )
}
