/**
 * Форма добавления аккаунта (диалог) — change web-interface, design D4.
 *
 * Поля provider/login/password/authStrategy → POST /api/accounts. При успехе
 * вызывает onSaved (обновление списка аккаунтов в App).
 */
import { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem, Box, Alert } from '@mui/material';
import * as api from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function AddAccountForm({ open, onClose, onSaved }: Props): JSX.Element {
  const [provider, setProvider] = useState('yandex');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [authStrategy, setAuthStrategy] = useState('basic');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!login || !password) return;
    setSaving(true);
    setError(null);
    try {
      await api.createAccount({ provider, login, password, authStrategy });
      setLogin('');
      setPassword('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Добавить аккаунт</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField select label="Provider" value={provider} onChange={(e) => setProvider(e.target.value)} size="small">
            <MenuItem value="yandex">yandex</MenuItem>
            <MenuItem value="outlook">outlook</MenuItem>
            <MenuItem value="mail">mail</MenuItem>
          </TextField>
          <TextField label="Login (email)" value={login} onChange={(e) => setLogin(e.target.value)} size="small" required />
          <TextField label="Password (пароль приложения)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} size="small" required />
          <TextField select label="Auth Strategy" value={authStrategy} onChange={(e) => setAuthStrategy(e.target.value)} size="small">
            <MenuItem value="basic">basic</MenuItem>
            <MenuItem value="oauth2">oauth2</MenuItem>
          </TextField>
          {error && <Alert severity="error">{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving || !login || !password}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
