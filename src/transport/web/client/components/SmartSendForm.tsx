/**
 * Форма Smart Send — change web-interface, design D4/D5.
 *
 * Поля получатель/тема/промпт → кнопка «Сгенерировать» → тело для редактирования
 * → кнопки «Отправить»/«Отмена». Подтверждение перед отправкой (как CLI).
 */
import { useState } from 'react';
import { Box, TextField, Button, Typography, Card, CardContent, Alert } from '@mui/material';
import { Send as SendIcon } from '@mui/icons-material';
import * as api from '../api';

interface Props {
  accountLogin: string;
}

export function SmartSendForm({ accountLogin }: Props): JSX.Element {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [prompt, setPrompt] = useState('');
  const [body, setBody] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to || !subject || !prompt) return;
    setGenerating(true);
    setError(null);
    setSent(false);
    try {
      const result = await api.smartSendGenerate({ accountLogin, to, subject, prompt });
      setBody(result.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      await api.smartSendSend({ accountLogin, to, subject, body });
      setSent(true);
      setBody('');
      setTo('');
      setSubject('');
      setPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Smart Send</Typography>
        <Box component="form" onSubmit={handleGenerate} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField label="Получатель (email)" size="small" value={to} onChange={(e) => setTo(e.target.value)} required />
          <TextField label="Тема" size="small" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          <TextField label="Промпт для генерации тела" size="small" multiline rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
          <Button type="submit" variant="contained" disabled={generating || !to || !subject || !prompt}>
            {generating ? 'Генерация…' : 'Сгенерировать'}
          </Button>
        </Box>

        {body && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>Сгенерированное тело (можно редактировать):</Typography>
            <TextField
              fullWidth
              multiline
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button variant="contained" startIcon={<SendIcon />} onClick={handleSend} disabled={sending}>
                {sending ? 'Отправка…' : 'Отправить'}
              </Button>
              <Button variant="outlined" onClick={() => setBody('')}>Отмена</Button>
            </Box>
          </Box>
        )}

        {sent && <Alert severity="success" sx={{ mt: 2 }}>Письмо отправлено.</Alert>}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </CardContent>
    </Card>
  );
}
