import type { RoundState } from '@calash/game-core';

export interface PlayerSlot {
  userId: string;
  seatIndex: number;
  isReady: boolean;
  socketId: string | null;
  displayName: string;
}

export interface ActiveRound {
  roundId: string;
  roundNumber: number;
  dealerIndex: number;
  state: RoundState;
  cumulativeScores: Record<string, number>;
  /** Per-player list of finalScore values, one entry per completed round. */
  roundScores: Record<string, number[]>;
}

export interface RoomState {
  roomId: string;
  inviteCode: string;
  hostUserId: string;
  status: 'lobby' | 'in-progress' | 'finished';
  maxPlayers: number;
  players: PlayerSlot[];
  round: ActiveRound | null;
}

class RoomStore {
  private readonly rooms = new Map<string, RoomState>();
  private readonly codeIndex = new Map<string, string>();
  private readonly userIndex = new Map<string, string>();

  set(room: RoomState): void {
    this.rooms.set(room.roomId, room);
    this.codeIndex.set(room.inviteCode.toUpperCase(), room.roomId);
    for (const p of room.players) {
      this.userIndex.set(p.userId, room.roomId);
    }
  }

  get(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  getByCode(code: string): RoomState | undefined {
    const roomId = this.codeIndex.get(code.toUpperCase());
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  getRoomForUser(userId: string): RoomState | undefined {
    const roomId = this.userIndex.get(userId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  trackUser(userId: string, roomId: string): void {
    this.userIndex.set(userId, roomId);
  }

  untrackUser(userId: string): void {
    this.userIndex.delete(userId);
  }

  delete(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      this.codeIndex.delete(room.inviteCode.toUpperCase());
      for (const p of room.players) this.userIndex.delete(p.userId);
    }
    this.rooms.delete(roomId);
  }

  updateSocket(roomId: string, userId: string, socketId: string | null): void {
    const player = this.rooms.get(roomId)?.players.find((p) => p.userId === userId);
    if (player) player.socketId = socketId;
  }

  all(): RoomState[] {
    return Array.from(this.rooms.values());
  }
}

export const roomStore = new RoomStore();

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
