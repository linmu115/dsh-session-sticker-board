import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StickerRecord } from '../protocol.ts';
const colors = { yellow: '黄色', green: '绿色', pink: '粉色', blue: '蓝色' } as const;
export function StickerColorPicker({ value, onChange, stickerId, disabled = false }: {
  value: StickerRecord['color']; onChange(color: StickerRecord['color']): void; stickerId: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('dsh-sticker-color-preview', { detail: { stickerId, color: value } }));
    return () => { window.dispatchEvent(new CustomEvent('dsh-sticker-color-preview', { detail: { stickerId } })); };
  }, [stickerId, value]);
  return <div className="dsh-sticker-color-picker" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="dsh-sticker-color-trigger" aria-label="高亮颜色" title={`高亮颜色：${colors[value]}`} aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
      <span className={`dsh-sticker-board-swatch-${value}`} />
    </button>
    {open && <div className="dsh-sticker-color-palette" role="group" aria-label="选择高亮颜色">
      {(Object.keys(colors) as StickerRecord['color'][]).map(color => <button key={color} type="button" className={`dsh-sticker-board-swatch dsh-sticker-board-swatch-${color}`} title={colors[color]} aria-label={colors[color]} aria-pressed={value === color} onClick={() => { onChange(color); setOpen(false); trigger.current?.focus(); }}>
        {value === color && <Check size={13} />}
      </button>)}
    </div>}
  </div>;
}
