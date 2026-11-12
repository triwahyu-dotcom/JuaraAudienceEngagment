import type { CSSProperties, ReactNode } from 'react';
import type { EventData, FlashMsg, Reward } from './types';

export function Flash({ msg }: { msg: FlashMsg }) {
  if (!msg) return null;
  return (
    <div className={'flash ' + msg.type} role="status">
      <span>{msg.text}</span>
      {msg.sub ? <small>{msg.sub}</small> : null}
    </div>
  );
}

export function Shell({ event, tag, children }: { event: EventData | null; tag: string; children: ReactNode }) {
  const style = event?.accent_color ? ({ '--accent': event.accent_color } as CSSProperties) : undefined;
  return (
    <div className="app" style={style}>
      <header>
        <div className="brand">
          {event?.logo_url ? <img src={event.logo_url} alt={'Logo ' + event.name} /> : null}
          <h1>{event ? event.name + ' Passport' : 'JUARA Passport'}</h1>
          <span>{tag}</span>
        </div>
      </header>
      {children}
    </div>
  );
}

export function RewardPic({ reward, className }: { reward: Reward; className: string }) {
  return reward.photo_url
    ? <img className={className} src={reward.photo_url} alt={'Foto ' + reward.name} />
    : <span className={className + ' ph'} aria-hidden="true">{reward.name.charAt(0).toUpperCase()}</span>;
}

export function NotConfigured() {
  return (
    <section className="card">
      <h2>Aplikasi belum terhubung ke database</h2>
      <p className="note">Isi NEXT_PUBLIC_SUPABASE_ANON_KEY di pengaturan hosting atau di file .env.local, lalu build ulang. Langkahnya ada di README.</p>
    </section>
  );
}
