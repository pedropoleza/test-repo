"use client";

const EMOJIS = [
  "📄","📝","📌","📎","📁","📂","🗂","📊","📈","📉","📅","📆","🗓","✅","☑️","📋",
  "💡","🔥","⭐","🌟","🎯","🚀","🧭","🧩","🛠","⚙️","🔧","🔩","🧱","🏗","🏛","🏢",
  "💼","📣","📢","📮","📬","✉️","💬","💭","🔔","🔒","🔑","🗝","🧾","💰","💳","🏷",
  "👤","👥","🧑‍💼","🤝","📞","☎️","📱","💻","🖥","🗄","📚","📖","🔖","🏷️","🎨","🧠",
];

export function IconPicker({
  onPick,
  onRemove,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 59 }}
        onClick={onClose}
      />
      <div
        className="pop"
        style={{ zIndex: 60, width: 300, top: 40, padding: 10 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(8, 1fr)",
            gap: 2,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => onPick(e)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 20,
                padding: 4,
                borderRadius: 6,
                lineHeight: 1,
              }}
              onMouseEnter={(ev) =>
                (ev.currentTarget.style.background = "var(--hover)")
              }
              onMouseLeave={(ev) =>
                (ev.currentTarget.style.background = "transparent")
              }
            >
              {e}
            </button>
          ))}
        </div>
        <div className="pop-sep" />
        <div className="pop-item danger" onClick={onRemove}>
          Remove icon
        </div>
      </div>
    </>
  );
}
