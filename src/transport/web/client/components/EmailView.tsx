/**
 * Чтение тела письма (правая панель) — change web-interface, design D4/D7.
 *
 * Шапка (тема, отправитель, получатели, дата) + тело (HTML санитизировано через
 * DOMPurify, plain-text с переносами) + список вложений с кнопкой скачивания.
 */
import { useMemo } from 'react';
import { Card, CardContent, Typography, Box, Button, Chip, Divider } from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';
import DOMPurify from 'dompurify';
import * as api from '../api';
import type { EmailFull } from '../api';

interface Props {
  email: EmailFull;
  accountLogin: string;
  onAnalyze: (uid: number) => void;
  onAnalyzeAttachments: (uid: number) => void;
}

export function EmailView({ email, accountLogin, onAnalyze, onAnalyzeAttachments }: Props): JSX.Element {
  // Санитизация HTML-тела: удаление скриптов/внешних ресурсов через DOMPurify.
  const sanitizedBody = useMemo(() => {
    const body = email.body ?? '';
    // Если тело похоже на HTML — санитизируем; иначе показываем как plain text.
    if (/<[a-z][\s\S]*>/i.test(body)) {
      return { __html: DOMPurify.sanitize(body, { FORBID_TAGS: ['script', 'style'], FORBID_ATTR: ['onload', 'onclick'] }) };
    }
    return null;
  }, [email.body]);

  return (
    <Card>
      <CardContent>
        {/* Шапка письма */}
        <Typography variant="h6" gutterBottom>{email.subject || '(без темы)'}</Typography>
        <Box sx={{ mb: 1, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            <strong>От:</strong> {email.from?.name ? `${email.from.name} <${email.from.address}>` : (email.from?.address ?? 'неизвестно')}
          </Typography>
          {email.to && email.to.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              <strong>Кому:</strong> {email.to.map((t) => t.address).join(', ')}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            <strong>Дата:</strong> {email.date.slice(0, 16).replace('T', ' ')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <strong>UID:</strong> {email.uid}
          </Typography>
        </Box>
        {email.flags.includes('\\Seen') === false && <Chip size="small" color="primary" label="непрочитано" sx={{ mr: 1 }} />}

        <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" onClick={() => onAnalyze(email.uid)}>
            Анализировать
          </Button>
          <Button size="small" variant="outlined" onClick={() => onAnalyzeAttachments(email.uid)}>
            Анализ вложений
          </Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Тело письма */}
        <Box sx={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {sanitizedBody ? (
            <div dangerouslySetInnerHTML={sanitizedBody} />
          ) : (
            <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
              {email.body || '(тело недоступно)'}
            </Typography>
          )}
        </Box>

        {/* Вложения */}
        {email.attachments.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>Вложения:</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {email.attachments.map((att) => (
                <Box key={att.part} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ flexGrow: 1 }}>
                    {att.filename}
                    {att.size ? ` (${formatSize(att.size)})` : ''}
                  </Typography>
                  <Button
                    size="small"
                    startIcon={<DownloadIcon />}
                    href={api.attachmentDownloadUrl(accountLogin, email.uid, att.filename)}
                    download={att.filename}
                  >
                    Скачать
                  </Button>
                </Box>
              ))}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
