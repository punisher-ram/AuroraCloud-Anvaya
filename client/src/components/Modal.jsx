export default function Modal({open,onClose,title,children}){
  if(!open) return null;
  return <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md grid place-items-center p-4" onMouseDown={onClose}>
    <div onMouseDown={e=>e.stopPropagation()} className="w-full max-w-md glass rounded-3xl p-6 shadow-2xl animate-in">
      <div className="flex items-center justify-between mb-5"><div className="font-semibold">{title}</div><button onClick={onClose} className="icon-btn">×</button></div>
      {children}
    </div>
  </div>
}
