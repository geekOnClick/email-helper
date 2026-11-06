/**
 * Панель анализа (правая панель) — change web-interface, design D4.
 *
 * Индикатор прогресса (CircularProgress) + читаемый рендер отчёта LLM
 * (заголовки/абзацы/списки через форматирование markdown-подобного текста).
 */
import { Card, CardContent, Typography, Box, CircularProgress, Divider, Chip } from '@mui/material';

interface Props {
  title: string;
  analysis: string;
  loading: boolean;
  error?: string;
  skipped?: { filename: string; reason?: string }[];
}

export function AnalyzePanel({ title, analysis, loading, error, skipped }: Props): JSX.Element {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>{title}</Typography>
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, my: 3 }}>
            <CircularProgress size={24} />
            <Typography color="text.secondary">Анализирую…</Typography>
          </Box>
        )}
        {error && (
          <Typography color="error" sx={{ mb: 2 }}>Ошибка анализа: {error}</Typography>
        )}
        {!loading && analysis && (
          <FormattedReport text={analysis} />
        )}
        {skipped && skipped.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>Не проанализировано (неподдерживаемый формат):</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {skipped.map((s) => (
                <Chip key={s.filename} size="small" variant="outlined" label={`${s.filename}${s.reason ? `: ${s.reason}` : ''}`} />
              ))}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Читаемый рендер отчёта LLM: разбивает по строкам, выделяет заголовки
 * (строки, оканчивающиеся на ':' или начинающиеся с '#'), списки ('- ' / '• '),
 * остальные — абзацы. Простейшее форматирование без markdown-библиотеки.
 */
function FormattedReport({ text }: { text: string }): JSX.Element {
  const lines = text.split('\n');
  return (
    <Box>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === '') return <Box key={i} sx={{ height: 8 }} />;
        if (/^#{1,4}\s/.test(trimmed) || /^[А-ЯA-Z][\s\S]*:$/.test(trimmed)) {
          return <Typography key={i} variant="subtitle1" sx={{ mt: 1, fontWeight: 600 }}>{trimmed.replace(/^#{1,4}\s/, '')}</Typography>;
        }
        if (/^[-•]\s/.test(trimmed)) {
          return (
            <Typography key={i} component="div" sx={{ pl: 2, py: 0.25 }}>
              • {trimmed.replace(/^[-•]\s/, '')}
            </Typography>
          );
        }
        return <Typography key={i} paragraph sx={{ my: 0.5 }}>{trimmed}</Typography>;
      })}
    </Box>
  );
}
