// GamificationUI.jsx
import React from "react";
import { Flame, Star, Award, Lock, Check, X, Sparkles, Target } from "lucide-react";
import { BADGES, levelProgress, rankFor } from "./gamification.js";
import { narrativeForReward } from "./gamificationNarrative.js";

const COLORS = {
  bg: "#0F1826",
  bg2: "#0B121D",
  card: "#16233A",
  cardBorder: "#233350",
  text: "#EDEFF2",
  sub: "#93A2BA",
  gold: "#C9A24B",
  rose: "#D6685C",
  teal: "#3FA796",
};

/* ---------- Faixa do header: streak · nível · XP ---------- */
export function GamHeaderStrip({ gam }) {
  const lp = levelProgress(gam.xp);
  const rank = rankFor(lp.level);
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="gam-strip">
      <div className="flex items-center gap-1 rounded-full px-2.5 py-1 border" title="Dias seguidos estudando"
        style={{ borderColor: COLORS.rose + "88", background: COLORS.rose + "15" }}>
        <Flame size={13} style={{ color: COLORS.rose }} />
        <span className="text-xs font-mono" style={{ color: COLORS.rose }}>{gam.streak.current}</span>
      </div>
      <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border" title={rank.name}
        style={{ borderColor: COLORS.gold + "88", background: COLORS.gold + "15" }}>
        <span className="text-sm leading-none">{rank.emoji}</span>
        <span className="text-xs font-mono" style={{ color: COLORS.gold }}>Nv.{lp.level}</span>
      </div>
      <div className="hidden sm:flex items-center gap-1.5 min-w-[120px]">
        <div className="h-1.5 flex-1 rounded-full" style={{ background: COLORS.cardBorder }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${lp.pct}%`, background: COLORS.gold }} />
        </div>
        <span className="text-[10px] font-mono" style={{ color: COLORS.sub }}>{lp.into}/{lp.span}</span>
      </div>
    </div>
  );
}

/* ---------- Barra da meta diária (topo do Cronograma) ---------- */
export function DailyGoalBar({ gam }) {
  const pct = Math.min(100, Math.round((gam.today.xp / gam.dailyGoal) * 100));
  const hit = pct >= 100;
  return (
    <div className="rounded-lg p-3 border mb-4" style={{ borderColor: hit ? COLORS.teal : COLORS.cardBorder, background: hit ? COLORS.teal + "12" : COLORS.bg2 }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs flex items-center gap-1.5" style={{ color: hit ? COLORS.teal : COLORS.sub }}>
          {hit ? <Check size={12} /> : <Target size={12} />}
          Meta do dia {hit ? "batida!" : `${gam.today.xp}/${gam.dailyGoal} XP`}
        </span>
        <span className="text-[10px] font-mono" style={{ color: COLORS.sub }}>
          🔥 {gam.streak.current} · 🍅 {gam.today.pomodoros} · 🧠 {gam.today.flashcards}
        </span>
      </div>
      <div className="h-2 rounded-full" style={{ background: COLORS.cardBorder }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: hit ? COLORS.teal : COLORS.gold }} />
      </div>
    </div>
  );
}

/* ---------- Toast de recompensa (aparece após award) ---------- */
export function RewardToast({ reward, onClose }) {
  if (!reward) return null;
  const big = reward.levelUp || (reward.newBadges?.length > 0);
  const narrative = narrativeForReward(reward);
  const actionMsg = reward.actionMsg || "";
  return (
    <div className="fixed left-1/2 bottom-20 z-[95] w-[92%] max-w-md -translate-x-1/2" role="status" aria-live="polite" data-testid="reward-toast">
      <div className="flex gap-3 rounded-xl border-2 p-3.5"
        style={{ background: COLORS.card, borderColor: big ? COLORS.gold : COLORS.teal, boxShadow: `0 8px 30px ${COLORS.gold}44` }}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: big ? COLORS.gold : COLORS.teal, color: "#0B121D" }}>
          {reward.levelUp ? <Sparkles size={20} /> : <Star size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base">
            {reward.levelUp ? `Nível ${reward.newLevel}!` : `+${reward.gainedXP} XP`}
            {reward.levelUp && <span className="ml-2 text-xs font-mono" style={{ color: COLORS.sub }}>+{reward.gainedXP} XP</span>}
          </p>
          {narrative && <p className="text-[11px] mt-0.5" style={{ color: COLORS.gold }}>{narrative}</p>}
          {actionMsg && <p className="text-[11px] mt-0.5" style={{ color: COLORS.sub }}>{actionMsg}</p>}
          {reward.missionsDone?.length > 0 && (
            <p className="text-[11px] mt-0.5" style={{ color: COLORS.teal }}>
              Missão completa: {reward.missionsDone.map((m) => m.title).join(", ")}
            </p>
          )}
        </div>
        <button onClick={onClose} aria-label="Fechar"><X size={14} style={{ color: COLORS.sub }} /></button>
      </div>
    </div>
  );
}

/* ---------- Tela "Conquistas" (nova aba) ---------- */
export function AchievementsScreen({ gam, onSetGoal }) {
  const lp = levelProgress(gam.xp);
  const rank = rankFor(lp.level);
  const unlockedCount = Object.keys(gam.unlocked).length;

  return (
    <div className="space-y-5">
      {/* Cartão de nível */}
      <div className="rounded-xl border p-5" style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 text-3xl"
            style={{ borderColor: COLORS.gold, background: COLORS.bg2 }}>
            {rank.emoji}
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: COLORS.gold }}>
              {rank.name}
            </div>
            <div className="font-display text-2xl">Nível {lp.level}</div>
            <div className="mt-2 h-2 rounded-full" style={{ background: COLORS.cardBorder }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${lp.pct}%`, background: COLORS.gold }} />
            </div>
            <div className="text-[11px] font-mono mt-1" style={{ color: COLORS.sub }}>
              {lp.into}/{lp.span} XP para o nível {lp.level + 1} · total {gam.xp} XP
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <StatBox label="Streak" value={`🔥 ${gam.streak.current}`} sub={`recorde ${gam.streak.best}`} />
          <StatBox label="Carimbos" value={`${unlockedCount}/${BADGES.length}`} sub="conquistas" />
          <StatBox label="Freezes" value={`❄️ ${gam.streak.freezes}`} sub="protege streak" />
        </div>
      </div>

      {/* Meta diária */}
      <div className="rounded-xl border p-4" style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
        <p className="text-sm mb-2 font-medium">Meta diária de XP</p>
        <div className="flex items-center gap-2">
          <input type="range" min={10} max={200} step={10} value={gam.dailyGoal}
            onChange={(e) => onSetGoal(Number(e.target.value))} className="flex-1" />
          <span className="font-mono text-sm w-16 text-right" style={{ color: COLORS.gold }}>{gam.dailyGoal} XP</span>
        </div>
        <p className="text-[11px] mt-1" style={{ color: COLORS.sub }}>
          Cerca de {Math.ceil(gam.dailyGoal / 10)} pomodoros ou {Math.ceil(gam.dailyGoal / 50)} submatérias.
        </p>
      </div>

      {/* Missões da semana */}
      {gam.missions && (
        <div className="rounded-xl border p-4" style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
          <p className="text-sm mb-3 font-medium flex items-center gap-1.5">
            <Target size={14} style={{ color: COLORS.teal }} /> Missões da semana
          </p>
          <div className="space-y-2">
            {gam.missions.items.map((m) => {
              const pct = Math.min(100, Math.round((m.progress / m.target) * 100));
              return (
                <div key={m.id} className="rounded-lg p-2.5" style={{ background: COLORS.bg2 }}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span style={{ color: m.done ? COLORS.teal : COLORS.text }}>
                      {m.done && <Check size={11} className="inline mr-1" />}
                      {m.title}
                    </span>
                    <span className="font-mono" style={{ color: COLORS.sub }}>{m.progress}/{m.target}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: COLORS.cardBorder }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.done ? COLORS.teal : COLORS.gold }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Grade de badges */}
      <div className="rounded-xl border p-4" style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
        <p className="text-sm mb-3 font-medium flex items-center gap-1.5">
          <Award size={14} style={{ color: COLORS.gold }} /> Carimbos do Diário
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {BADGES.map((b) => {
            const unlockedAt = gam.unlocked[b.id];
            return (
              <div key={b.id}
                title={unlockedAt ? `Desbloqueado em ${unlockedAt}\n${b.desc}` : b.desc}
                className="flex flex-col items-center justify-center rounded-lg p-2 border text-center"
                style={{
                  background: unlockedAt ? COLORS.gold + "18" : COLORS.bg2,
                  borderColor: unlockedAt ? COLORS.gold : COLORS.cardBorder,
                  opacity: unlockedAt ? 1 : 0.55,
                }}>
                <span className="text-2xl mb-1">{unlockedAt ? b.emoji : <Lock size={20} style={{ color: COLORS.sub }} />}</span>
                <span className="text-[10px] leading-tight" style={{ color: unlockedAt ? COLORS.gold : COLORS.sub }}>
                  {b.name}
                </span>
                {!unlockedAt && <span className="text-[9px] leading-tight mt-0.5" style={{ color: COLORS.sub }}>{b.desc}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, sub }) {
  return (
    <div className="rounded-lg py-2" style={{ background: COLORS.bg2 }}>
      <div className="text-base">{value}</div>
      <div className="text-[10px] uppercase tracking-widest" style={{ color: COLORS.sub }}>{label}</div>
      <div className="text-[10px]" style={{ color: COLORS.sub }}>{sub}</div>
    </div>
  );
}
