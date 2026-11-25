import { useId, useState, type FormEvent } from 'react';
import { errorMessage } from '../../data/api';
import { closeOverlay, closeSide, deleteAccount } from '../../state/account';
import { Dialog } from './Dialog';
import { Notice } from './SignIn';

const WORD = 'supprimer';

/** Confirmation de la suppression du compte : on retape « supprimer ». */
export function DeleteAccountDialog() {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const confirmed = typed.trim().toLowerCase() === WORD;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    deleteAccount().then(closeSide, (err: unknown) => {
      setError(errorMessage(err));
      setBusy(false);
    });
  };

  return (
    <Dialog label="Supprimer mon compte" onClose={closeOverlay}>
      <h2 className="title-lg">Supprimer mon compte</h2>
      <p className="lead">
        Votre compte et tout ce qu’il garde (favoris et préférences synchronisés) sont supprimés tout de suite, sans retour possible. Les
        favoris enregistrés sur cet appareil y restent.
      </p>
      <form className="dialog-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor={fieldId}>Pour confirmer, tapez « {WORD} »</label>
          <input
            id={fieldId}
            className="input"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            data-autofocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        {error && <Notice>{error}</Notice>}
        <button type="submit" className="btn btn-secondary btn-danger btn-lg btn-block" disabled={!confirmed || busy}>
          Supprimer mon compte
        </button>
      </form>
      <button type="button" className="btn btn-ghost btn-block dialog-second" onClick={closeOverlay}>
        Annuler
      </button>
    </Dialog>
  );
}
