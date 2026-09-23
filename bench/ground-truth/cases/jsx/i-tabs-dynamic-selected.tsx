type Tab = { id: string; title: string }

export function Tabs({ tabs, active, onSelect }: { tabs: Tab[]; active: string; onSelect: (id: string) => void }) {
  return (
    <div role="tablist" aria-label="Sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`panel-${tab.id}`}
          tabIndex={tab.id === active ? 0 : -1}
          onClick={() => onSelect(tab.id)}
        >
          {tab.title}
        </button>
      ))}
    </div>
  )
}
