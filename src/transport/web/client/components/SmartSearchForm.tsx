/**
 * Форма Smart Search — change web-interface, design D4.
 *
 * Поле промпта + кнопка «Найти». Результат передаётся в App (обновляет список
 * писем слева).
 */
import { useState } from 'react';
import { Box, TextField, Button, Typography } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';

interface Props {
  onSearch: (prompt: string) => void;
  disabled: boolean;
}

export function SmartSearchForm({ onSearch, disabled }: Props): JSX.Element {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) onSearch(prompt.trim());
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Smart Search</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Опишите, что искать, естественным языком (например «найди последнее письмо от ded@ded.ru»).
      </Typography>
      <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Найти письмо по промпту…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={disabled}
        />
        <Button type="submit" variant="contained" startIcon={<SearchIcon />} disabled={disabled || !prompt.trim()}>
          Найти
        </Button>
      </Box>
    </Box>
  );
}
