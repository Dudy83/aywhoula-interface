import { CircleAlert, Mail } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { errorMessage } from '../../data/api';
import { closeOverlay, googleSignInUrl, openSignIn, refreshAccount, requestLoginLink, signInWithCode, type Overlay } from '../../state/account';
import { Dialog } from './Dialog';

/** Le logo de Google, à ses couleurs : c'est sa marque, pas une couleur de l'interface. */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6c1.9-5.6 7.1-9.7 13.5-9.7z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.4-4 6.8-10 6.8-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.8c-.5-1.4-.8-3-.8-4.8s.3-3.4.8-4.8l-7.8-6C1 16.5 0 20.1 0 24s1 7.5 2.7 10.8l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.4 0-11.6-4.1-13.5-9.7l-7.8 6C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** Message dans le parcours de compte : neutre, le rouge étant réservé au paiement refusé et à la suppression. */
export function Notice({ children }: { children: string }) {
  return (
    <p className="notice" role="alert">
      <CircleAlert size={15} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Écran `connexion` : l'adresse email pour recevoir le lien, ou Google. */
export function SignInDialog({ overlay }: { overlay: Extract<Overlay, { kind: 'signin' }> }) {
  const [email, setEmail] = useState(overlay.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    requestLoginLink(email.trim(), overlay.resume).catch((err: unknown) => {
      setError(errorMessage(err));
      setBusy(false);
    });
  };

  // Venu de l'offre : la connexion est la première étape de l'essai, et l'écran le dit.
  const trial = overlay.resume.action === 'trial';

  return (
    <Dialog label="Créez votre compte" onClose={closeOverlay}>
      <p className="hint">Étape 1 sur 2{trial && ' · essai gratuit Premium'}</p>
      <h2 className="title-lg">Créez votre compte</h2>
      <p className="lead">
        {trial ? 'Pour lancer votre essai et retrouver vos favoris sur tous vos appareils.' : 'Pour retrouver vos favoris sur tous vos appareils.'}
      </p>
      {overlay.notice && <Notice>{overlay.notice}</Notice>}
      <form className="dialog-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor={fieldId}>Adresse email</label>
          <input
            id={fieldId}
            className="input"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            data-autofocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && <Notice>{error}</Notice>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          Recevoir le lien de connexion
        </button>
      </form>
      <div className="or" aria-hidden="true">
        <span />
        ou
        <span />
      </div>
      <a className="btn btn-secondary btn-lg btn-block" href={googleSignInUrl(overlay.resume)}>
        <GoogleLogo />
        Continuer avec Google
      </a>
      <p className="hint dialog-legal">
        Pas de mot de passe : un lien sécurisé arrive par email. En continuant, vous acceptez les{' '}
        <a className="text-link" href="/api/site/conditions" target="_blank" rel="noreferrer">
          conditions d’utilisation
        </a>{' '}
        et la{' '}
        <a className="text-link" href="/api/site/confidentialite" target="_blank" rel="noreferrer">
          politique de confidentialité
        </a>
        .
      </p>
    </Dialog>
  );
}

/** Messageries en ligne les plus courantes, pour ouvrir la boîte de réception d'un clic. */
const INBOXES: [RegExp, string][] = [
  [/^(gmail|googlemail)\.com$/, 'https://mail.google.com/'],
  [/^(outlook|hotmail|live|msn)\.[a-z.]+$/, 'https://outlook.live.com/mail/'],
  [/^(yahoo\.[a-z.]+|ymail\.com)$/, 'https://mail.yahoo.com/'],
  [/^(icloud|me|mac)\.com$/, 'https://www.icloud.com/mail/'],
  [/^(proton\.me|protonmail\.(com|ch)|pm\.me)$/, 'https://mail.proton.me/'],
  [/^(orange|wanadoo)\.fr$/, 'https://messagerie.orange.fr/'],
  [/^free\.fr$/, 'https://webmail.free.fr/'],
  [/^(sfr|neuf)\.fr$/, 'https://webmail.sfr.fr/'],
  [/^laposte\.net$/, 'https://www.laposte.net/'],
  [/^gmx\.(fr|com|net)$/, 'https://www.gmx.fr/'],
];

/** La boîte de réception de cette adresse ; à défaut, l'application de messagerie de l'appareil. */
function inboxUrl(email: string): string {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  return INBOXES.find(([pattern]) => pattern.test(domain))?.[1] ?? 'mailto:';
}

const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

/**
 * Écran `lien` : le lien est parti, on attend que la personne l'ouvre, ou qu'elle saisisse
 * ici le code à 6 chiffres du même email. Le code connecte l'appli elle-même : c'est le
 * chemin de l'appli installée sur iPhone, où le lien s'ouvre dans Safari.
 */
export function SentDialog({ overlay }: { overlay: Extract<Overlay, { kind: 'sent' }> }) {
  const [left, setLeft] = useState(RESEND_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeId = useId();

  // Le code part tout seul dès que ses six chiffres sont là (saisis, collés, ou proposés par le clavier).
  const typeCode = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length < CODE_LENGTH || checking) return;
    setChecking(true);
    setCodeError(null);
    signInWithCode(overlay.email, digits).catch((err: unknown) => {
      setCodeError(errorMessage(err));
      setCode('');
      setChecking(false);
    });
  };

  // Compte à rebours avant de pouvoir renvoyer le lien.
  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);

  // Le lien ouvert dans ce navigateur connecte aussi cet onglet : on s'en aperçoit et on referme.
  useEffect(() => {
    let stopped = false;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshAccount().then((signed) => {
        if (signed && !stopped) closeOverlay();
      });
    };
    const timer = window.setInterval(check, 4000);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  const resend = () => {
    setBusy(true);
    setError(null);
    requestLoginLink(overlay.email, overlay.resume)
      .then(() => setLeft(RESEND_SECONDS))
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const inbox = inboxUrl(overlay.email);

  return (
    <Dialog label="Vérifiez votre boîte mail" onClose={closeOverlay}>
      <div className="round-icon">
        <Mail size={22} aria-hidden="true" />
      </div>
      <p className="hint">Étape 2 sur 2</p>
      <h2 className="title-lg">Vérifiez votre boîte mail</h2>
      <p className="lead lead-loose">
        Un lien de connexion vient de partir vers <b>{overlay.email}</b>. Il est valable 15 minutes.
      </p>
      {error && <Notice>{error}</Notice>}
      <a
        className="btn btn-primary btn-lg btn-block dialog-action"
        href={inbox}
        {...(inbox.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noreferrer' })}
        data-autofocus
      >
        Ouvrir ma messagerie
      </a>
      <div className="field code-field">
        <label htmlFor={codeId}>Ou saisissez le code reçu</label>
        <input
          id={codeId}
          className="input code-input num"
          type="text"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={CODE_LENGTH + 1}
          placeholder="••••••"
          disabled={checking}
          value={code}
          onChange={(e) => typeCode(e.target.value)}
        />
      </div>
      {codeError && <Notice>{codeError}</Notice>}
      <button type="button" className="btn btn-ghost btn-block dialog-second" disabled={left > 0 || busy} onClick={resend}>
        Renvoyer le lien
        {left > 0 && (
          <span className="hint num">
            · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          </span>
        )}
      </button>
      <p className="hint dialog-center">
        <button type="button" className="text-link" onClick={() => openSignIn(overlay.resume, { email: overlay.email })}>
          Changer d’adresse
        </button>
      </p>
    </Dialog>
  );
}
