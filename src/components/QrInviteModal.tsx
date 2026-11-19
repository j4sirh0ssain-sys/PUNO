import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, X } from 'lucide-react';
import type { TableTheme } from '../game/themes.ts';

interface QrInviteModalProps {
  inviteUrl: string;
  roomId: string;
  opponentConnected: boolean;
  opponentName: string;
  theme?: TableTheme;
  onClose: () => void;
}

export function QrInviteModal({
  inviteUrl,
  roomId,
  opponentConnected,
  opponentName,
  theme,
  onClose,
}: QrInviteModalProps) {
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    void QRCode.toCanvas(canvas, inviteUrl, {
      width: 220,
      margin: 2,
      color: {
        dark: '#0c1320',
        light: '#ffffff',
      },
    });
  }, [inviteUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl text-center border"
        style={{
          backgroundColor: theme?.surface ?? '#101d28',
          borderColor: theme?.surfaceBorder ?? '#284452',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="qr-modal-title" className="font-display text-xl font-bold text-[#f4f4ed]">
            Invite Second Player
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 inline-flex items-center justify-center rounded-xl text-[#9fb3b0] hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-[#f5c84b]"
            aria-label="Close invite dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-[#b8c7c5] mb-4">
          Scan this QR code on another device or share the room link to play live.
        </p>

        <div className="inline-block rounded-xl bg-white p-3 mb-4 shadow-lg">
          <canvas ref={qrCanvasRef} className="block" />
        </div>

        <div className="text-xs font-mono-tabular text-[#b8c7c5] mb-3">
          Room {roomId} · {opponentConnected ? `${opponentName} connected` : 'Waiting for player to join'}
        </div>

        <div className="flex items-center gap-2 bg-black/35 border border-white/10 rounded-xl p-2 mb-5">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            aria-label="Invite link"
            className="flex-1 bg-transparent text-xs text-[#e2ecea] font-mono-tabular px-2 outline-none truncate"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-[#f4f4ed] transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#f5c84b]"
          >
            {copied ? <Check className="w-4 h-4 text-[#16b07a]" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy Link'}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 px-4 rounded-xl text-[#151c27] font-bold text-sm transition-opacity hover:opacity-90 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white"
          style={{ backgroundColor: theme?.accent ?? '#f5c84b' }}
        >
          {opponentConnected ? 'Back to Table' : 'Wait at Table'}
        </button>
      </div>
    </div>
  );
}
