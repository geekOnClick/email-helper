/**
 * Форма анализа одного письма (Analyze) — change web-interface.
 *
 * Критерии поиска (тема, отправитель, дата) → поиск писем → выбор письма в
 * левом списке → анализ выбранного письма (через onSelectUid, который вызывает
 * `runAnalyze` в App). Сама форма только запускает поиск.
 */
import { useState } from 'react';
import { Box, TextField, Button, Typography } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { parseDisplayDate } from '../dateFormat';

interface Props {
  onSearch: (criteria: { subject?: string; from?: string; date?: string }) => void;
  disabled: boolean;
}

export function AnalyzeForm({ onSearch, disabled }: Props): JSX.Element {
  const [subject, setSubject] = useState('');
  const [from, setFrom] = useState('');
  const [date, setDate] = useState('');
  const [dateError, setDateError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseDisplayDate(date);
    if (!parsed.ok) {
      setDateError(parsed.error);
      return;
    }
    setDateError('');
    const criteria: { subject?: string; from?: string; date?: string } = {};
    if (subject.trim()) criteria.subject = subject.trim();
    if (from.trim()) criteria.from = from.trim();
    if (parsed.iso) criteria.date = parsed.iso;
    if (Object.keys(criteria).length === 0) return;
    onSearch(criteria);
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Analyze</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Введите критерии поиска письма, затем выберите письмо в списке слева для
        анализа его содержимого.
      </Typography>
      <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 480 }}>
        <TextField label="Тема" size="small" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={disabled} />
        <TextField label="Отправитель (email)" size="small" value={from} onChange={(e) => setFrom(e.target.value)} disabled={disabled} />
        <TextField
          label="Дата (ДД.ММ.ГГ)"
          size="small"
          placeholder="03.11.26"
          value={date}
          onChange={(e) => { setDate(e.target.value); if (dateError) setDateError(''); }}
          disabled={disabled}
          error={Boolean(dateError)}
          helperText={dateError || 'Например: 03.11.26 (или 03.11.2026)'}
        />
        <Button type="submit" variant="contained" startIcon={<SearchIcon />} disabled={disabled || (!subject && !from && !date)}>
          Найти письма
        </Button>
      </Box>
    </Box>
  );
}