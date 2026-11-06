/**
 * Список писем слева — change web-interface, design D4.
 *
 * Показывает тему, отправителя, дату, флаг непрочитанного. Выбор письма
 * вызывает onSelect (фетч тела в App).
 */
import { List, ListItemButton, ListItemText, Typography, Box, Chip } from '@mui/material';
import type { EmailMessage } from '../api';

interface Props {
  emails: EmailMessage[];
  onSelect: (msg: EmailMessage) => void;
  /** Подсказка режима выбора (что делает клик). Опционально. */
  hint?: string;
}

export function EmailList({ emails, onSelect, hint }: Props): JSX.Element {
  if (emails.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography color="text.secondary">
          {hint ?? 'Нет писем. Используйте Smart Search для поиска.'}
        </Typography>
      </Box>
    );
  }
  return (
    <List dense>
      {hint && (
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="caption" color="info.main">{hint}</Typography>
        </Box>
      )}
      {emails.map((m) => {
        const unseen = !m.flags.includes('\\Seen');
        const fromAddr = m.from?.address ?? 'неизвестно';
        const date = m.date.slice(0, 10);
        return (
          <ListItemButton key={m.uid} onClick={() => onSelect(m)}>
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {unseen && <Chip size="small" color="primary" label="new" />}
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: unseen ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {m.subject || '(без темы)'}
                  </Typography>
                </Box>
              }
              secondary={
                <Typography variant="caption" color="text.secondary">
                  {fromAddr} • {date}
                </Typography>
              }
            />
          </ListItemButton>
        );
      })}
    </List>
  );
}
