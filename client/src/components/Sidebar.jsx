import {
  LayoutDashboard, MessageCircle, NotebookPen, WalletCards, RefreshCcw,
  Cloud, CalendarDays, Globe2, LockKeyhole, Settings, Plus
} from "lucide-react";

const items = [
  ["home", "Command Center", LayoutDashboard],
  ["chat", "Chats", MessageCircle],
  ["notes", "Notes", NotebookPen],
  ["money", "Money", WalletCards],
  ["subs", "Subscriptions", RefreshCcw],
  ["vault", "Anvaya Vault", Cloud],
  ["calendar", "Calendar", CalendarDays],
  ["world", "World", Globe2],
  ["privacy", "Privacy Center", LockKeyhole],
  ["settings", "Settings", Settings]
];

export default function Sidebar({ page, setPage }) {
  return (
    <aside className="w-[248px] shrink-0 border-r border-white/[.06] bg-[#14070d]/85 flex flex-col">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-[#b33b60] via-[#5f2048] to-[#241039] grid place-items-center shadow-glow">
            <div className="h-4 w-4 rounded-full border-2 border-white/85 relative">
              <span className="absolute -right-1 -bottom-1 h-2.5 w-2.5 rounded-full bg-[#9f4d8b]" />
            </div>
          </div>
          <div>
            <div className="font-semibold tracking-tight">Anvaya</div>
            <div className="text-[11px] text-white/35">Private by default</div>
          </div>
        </div>
      </div>

      <div className="px-3 pb-3">
        <button className="w-full rounded-xl bg-white/[.045] border border-white/[.06] px-3 py-2.5 text-sm flex items-center gap-2 text-white/65 hover:bg-white/[.07]">
          <Plus size={16}/> Quick add
          <span className="ml-auto text-[10px] text-white/25">⌘K</span>
        </button>
      </div>

      <nav className="px-3 space-y-1 flex-1 overflow-auto scrollbar">
        {items.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setPage(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
              page === id ? "bg-aurora-700/25 text-aurora-200" : "text-white/50 hover:text-white/85 hover:bg-white/[.035]"
            }`}>
            <Icon size={18} strokeWidth={1.8}/>
            <span>{label}</span>
            {id === "chat" && <span className="ml-auto text-[10px] bg-aurora-600/25 text-aurora-200 rounded-full px-2 py-0.5">3</span>}
          </button>
        ))}
      </nav>

      <div className="p-3">
        <div className="rounded-2xl bg-gradient-to-br from-[#3d1427] to-[#20112d] border border-white/[.06] p-3">
          <div className="flex gap-2 items-start">
            <LockKeyhole size={16} className="text-emerald-300 mt-0.5"/>
            <div>
              <div className="text-xs font-medium">Astra is optional</div>
              <div className="text-[11px] text-white/35 mt-1">AI access is controlled by you.</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
