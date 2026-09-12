export default function IconButton({ icon: Icon, label, onClick, active=false, className="" }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`h-10 w-10 rounded-xl flex items-center justify-center transition ${
        active ? "bg-aurora-600/20 text-aurora-300" : "text-white/55 hover:text-white hover:bg-white/5"
      } ${className}`}
    >
      <Icon size={19} strokeWidth={1.8} />
    </button>
  );
}
