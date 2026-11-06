/**
 * Форма Analyze Many — change web-interface, design D4.
 *
 * Критерии поиска (тема, отправитель, диапазон дат) → анализ нескольких
 * писем. Результат — сводный отчёт в правой панели (AnalyzePanel).
 */
import { useState } from 'react';
import { Box, TextField, Button, Typography } from '@mui/material';
import { Analytics as AnalyticsIcon } from '@mui/icons-material';

interface Props {
  onAnalyze: (criteria: { subject?: string; from?: string; dateFrom?: string; dateTo?: string }) => void;
}

export function AnalyzeManyForm({ onAnalyze }: Props): JSX.Element {
  const [subject, setSubject] = useState('');
  const [from, setFrom] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const criteria: { subject?: string; from?: string; dateFrom?: string; dateTo?: string } = {};
    if (subject.trim()) criteria.subject = subject.trim();
    if (from.trim()) criteria.from = from.trim();
    if (dateFrom.trim()) criteria.dateFrom = dateFrom.trim();
    if (dateTo.trim()) criteria.dateTo = dateTo.trim();
    if (Object.keys(criteria).length === 0) return;
    onAnalyze(criteria);
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Analyze Many</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Критерии поиска для анализа нескольких писем (тема/отправитель/диапазон дат).
      </Typography>
      <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 480 }}>
        <TextField label="Тема" size="small" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <TextField label="Отправитель (email)" size="small" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField label="Дата с (YYYY-MM-DD)" size="small" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <TextField label="Дата по (YYYY-MM-DD)" size="small" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </Box>
        <Button type="submit" variant="contained" startIcon={<AnalyticsIcon />} disabled={!subject && !from && !dateFrom && !dateTo}>
          Анализировать
        </Button>
      </Box>
    </Box>
  );
}
