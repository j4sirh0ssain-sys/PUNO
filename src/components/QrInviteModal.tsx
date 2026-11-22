import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Play, ThumbsDown, UserX, X } from 'lucide-react';
import type { TableTheme } from '../game/themes.ts';
import type { SeatInfo } from '../game/types.ts';

interface QrInviteModalProps {
  inviteUrl: string;
  roomId: string;
  playerCount: number;
  seats: SeatInfo[];
  selfIndex?: number;
  hostIndex?: number;
  isHost: boolean;
  isWaiting: boolean;
  opponentConnected: boolean;
  opponentName: string;
  theme?: TableTheme;
  kickingSeatIndex?: number | null;
  votingSeatIndex?: number | null;
  onKickPlayer?: (seatIndex: number) => void;
  onVoteKick?: (seatIndex: number) => void;
  onStartMatch?: () => void;
  onStartWithCpus?: () => void;
  onClose: () => void;
}

export function QrInviteModal({
  inviteUrl,
  roomId,
  playerCount,
  seats,
  selfIndex = 0,
  hostIndex = 0,
  isHost,
  isWaiting,
  opponentConnected,
  opponentName,
  theme,
  kickingSeatIndex = null,
  votingSeatIndex = null,
  onKickPlayer,
  onVoteKick,
  onStartMatch,
  onStartWithCpus,
  onClose,
}: QrInviteModalProps) {
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas || !inviteUrl) return;
    void QRCode.toCanvas(canvas, inviteUrl, {
      width: 184,
      margin: 2,
      color: {
        dark: '#0c1320',
        light: '#ffffff',
      },
    });
  }, [inviteUrl]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const readyCount = seats.filter((s) => s.isCpu || (s.occupied ?? s.connected)).length;
  const humanCount = seats.filter((s) => !s.isCpu && (s.occupied ?? s.connected)).length;
  const canStartHumans = isHost && isWaiting && readyCount >= 2;
  const hasOpenSeats = isHost && isWaiting && readyCount < playerCount;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl text-center border max-h-[90dvh] overflow-y-auto"
        style={{
          backgroundColor: theme?.surface ?? '#101d28',
          borderColor: theme?.surfaceBorder ?? '#284452',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 id="qr-modal-title" className="font-display text-xl font-bold text-[#f4f4ed]">
            {playerCount === 2 ? 'Invite Second Player' : `Invite Players (${readyCount}/${playerCount})`}
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

        <p className="text-sm text-[#b8c7c5] mb-3">
          Scan the QR code on another device or enter this Room Code to join live:
        </p>

        {/* Prominent Room Code Copy Pill */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <button
            type="button"
            onClick={handleCopyCode}
            className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-black/35 border hover:bg-black/45 transition-colors focus-visible:outline-2 focus-visible:outline-[#f5c84b]"
            style={{ borderColor: theme?.surfaceBorder ?? '#284452' }}
            title="Copy room code"
          >
            <span className="text-xs text-[#9fb3b0] font-medium">Room Code</span>
            <span
              className="font-mono-tabular text-lg font-extrabold tracking-[0.18em]"
              style={{ color: theme?.accent ?? '#f5c84b' }}
            >
              {roomId}
            </span>
            {copiedCode ? (
              <Check className="w-4 h-4 text-[#16b07a]" />
            ) : (
              <Copy className="w-4 h-4 text-[#9fb3b0]" />
            )}
          </button>
        </div>

        <div className="inline-block rounded-xl bg-white p-3 mb-3 shadow-lg">
          <canvas ref={qrCanvasRef} className="block" />
        </div>

        <div className="text-xs font-mono-tabular text-[#b8c7c5] mb-3">
          {playerCount === 2
            ? opponentConnected
              ? `${opponentName} connected · Ready to start`
              : 'Waiting for player to join'
            : readyCount >= playerCount
              ? `All ${playerCount} players connected · Ready to start`
              : `${readyCount} of ${playerCount} seats ready`}
        </div>

        {seats.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-left mb-4">
            {seats.map((seat) => {
              const isOccupiedHuman = !seat.isCpu && (seat.occupied ?? seat.connected);
              const isSeatHost = seat.index === hostIndex;
              const isSelf = seat.index === selfIndex;
              const canHostKick = Boolean(
                isHost && onKickPlayer && !isSeatHost && isOccupiedHuman
              );
              const canVoteKick = Boolean(
                onVoteKick && !isSelf && isOccupiedHuman && humanCount >= 3
              );
              const isKicking = kickingSeatIndex === seat.index;
              const isVoting = votingSeatIndex === seat.index;
              const votes = seat.kickVotes ?? 0;
              const required = seat.kickVotesRequired ?? 2;

              return (
                <div
                  key={seat.index}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs"
                  style={{
                    backgroundColor:
                      seat.connected || isOccupiedHuman
                        ? 'rgba(255,255,255,0.05)'
                        : 'rgba(0,0,0,0.2)',
                    borderColor: theme?.surfaceBorder ?? '#284452',
                  }}
                >
                  <div className="min-w-0 flex items-center gap-1.5">
                    <span className="truncate font-semibold text-[#f4f4ed]">
                      {seat.name}
                    </span>
                    <span
                      className="text-[11px] font-mono-tabular shrink-0"
                      style={{
                        color: seat.connected
                          ? theme?.accent ?? '#34d399'
                          : isOccupiedHuman
                            ? '#fbbf24'
                            : '#7f9391',
                      }}
                    >
                      {seat.isCpu
                        ? 'CPU'
                        : isSeatHost
                          ? 'Host'
                          : seat.connected
                            ? 'Ready'
                            : isOccupiedHuman
                              ? 'Offline'
                              : 'Open'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canVoteKick && (
                      <button
                        type="button"
                        disabled={isVoting}
                        onClick={() => onVoteKick?.(seat.index)}
                        aria-label={`Vote to kick ${seat.name}`}
                        title={
                          seat.votedToKickBySelf
                            ? `Withdraw kick vote (${votes}/${required})`
                            : `Vote to kick ${seat.name} (${votes}/${required})`
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-bold disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-white ${
                          seat.votedToKickBySelf
                            ? 'bg-[#fb923c]/25 border-[#fb923c]/60 text-[#fed7aa]'
                            : 'bg-white/5 hover:bg-white/10 border-white/15 text-[#d6e2e0]'
                        }`}
                      >
                        <ThumbsDown className="w-3 h-3" />
                        <span className="font-mono-tabular">
                          {votes}/{required}
                        </span>
                      </button>
                    )}
                    {canHostKick && (
                      <button
                        type="button"
                        disabled={isKicking}
                        onClick={() => onKickPlayer?.(seat.index)}
                        aria-label={`Kick ${seat.name}`}
                        title={`Kick ${seat.name}`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#ee3f4f]/15 hover:bg-[#ee3f4f]/30 border border-[#ee3f4f]/40 text-[11px] font-bold text-[#ffb4bc] disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-white"
                      >
                        <UserX className="w-3 h-3" />
                        <span>{isKicking ? '...' : 'Kick'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 bg-black/35 border border-white/10 rounded-xl p-2 mb-4">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            aria-label="Invite link"
            className="flex-1 bg-transparent text-xs text-[#e2ecea] font-mono-tabular px-2 outline-none truncate"
          />
          <button
            type="button"
            onClick={handleCopyLink}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-[#f4f4ed] transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#f5c84b]"
          >
            {copiedLink ? <Check className="w-4 h-4 text-[#16b07a]" /> : <Copy className="w-4 h-4" />}
            {copiedLink ? 'Copied' : 'Copy Link'}
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {canStartHumans && onStartMatch && (
            <button
              type="button"
              onClick={onStartMatch}
              className="w-full h-11 px-4 rounded-xl text-[#151c27] font-bold text-sm transition-opacity hover:opacity-90 whitespace-nowrap inline-flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-white"
              style={{ backgroundColor: theme?.accent ?? '#f5c84b' }}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>
                {readyCount < playerCount
                  ? `Start Game (${readyCount} Players)`
                  : 'Start Game'}
              </span>
            </button>
          )}
          {hasOpenSeats && onStartWithCpus && (
            <button
              type="button"
              onClick={onStartWithCpus}
              className={`w-full h-11 px-4 rounded-xl font-bold text-sm transition-opacity hover:opacity-90 whitespace-nowrap inline-flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-white ${
                canStartHumans
                  ? 'bg-white/10 text-[#f4f4ed] hover:bg-white/15'
                  : 'text-[#151c27]'
              }`}
              style={
                !canStartHumans
                  ? { backgroundColor: theme?.accent ?? '#f5c84b' }
                  : undefined
              }
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Start Now (Fill Open Seats with CPUs)</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`w-full h-11 px-4 rounded-xl font-bold text-sm transition-opacity hover:opacity-90 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white ${
              canStartHumans || hasOpenSeats
                ? 'bg-white/10 text-[#f4f4ed] hover:bg-white/15'
                : 'text-[#151c27]'
            }`}
            style={
              !(canStartHumans || hasOpenSeats)
                ? { backgroundColor: theme?.accent ?? '#f5c84b' }
                : undefined
            }
          >
            {opponentConnected ? 'Back to Table' : 'Wait at Table'}
          </button>
        </div>
      </div>
    </div>
  );
}
