/**
 * Корневой компонент веб-SPA (change web-interface, design D4).
 *
 * Макет почтового клиента: AppBar сверху (тулбар команд + выбор аккаунта),
 * список писем слева (Drawer), чтение тела/анализ справа (основная зона).
 * Состояние: выбранный аккаунт, список писем, выбранное письмо, активная
 * команда/панель.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  ThemeProvider,
  createTheme,
  CircularProgress,
  Typography,
} from '@mui/material';
import { AccountSelector } from './components/AccountSelector';
import { CommandToolbar } from './components/CommandToolbar';
import { EmailList } from './components/EmailList';
import { EmailView } from './components/EmailView';
import { SmartSearchForm } from './components/SmartSearchForm';
import { AnalyzePanel } from './components/AnalyzePanel';
import { SmartSendForm } from './components/SmartSendForm';
import { AddAccountForm } from './components/AddAccountForm';
import { AnalyzeManyForm } from './components/AnalyzeManyForm';
import { AnalyzeForm } from './components/AnalyzeForm';
import { AnalyzeAttachmentsForm } from './components/AnalyzeAttachmentsForm';
import * as api from './api';
import type { AccountPublic, EmailMessage, EmailFull } from './api';

const theme = createTheme({
  palette: { mode: 'light' },
});

/** Тип активной правой панели. */
type RightPanel =
  | { kind: 'empty' }
  | { kind: 'search' }
  | { kind: 'analyzeForm' }
  | { kind: 'analyzeAttachmentsForm' }
  | { kind: 'analyzeManyForm' }
  | { kind: 'email'; email: EmailFull }
  | { kind: 'analyze'; analysis: string; loading: boolean; error?: string }
  | { kind: 'analyzeMany'; analysis: string; loading: boolean; error?: string }
  | { kind: 'analyzeAttachments'; analysis: string; loading: boolean; skipped: { filename: string; reason?: string }[]; error?: string }
  | { kind: 'smartSend' };

/** Режим выбора письма в левом списке: что делает клик по письму. */
type SelectionMode = 'view' | 'analyze' | 'analyzeAttachments';

const DRAWER_WIDTH = 340;

export function App(): JSX.Element {
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [selectedLogin, setSelectedLogin] = useState<string | null>(null);
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [panel, setPanel] = useState<RightPanel>({ kind: 'empty' });
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [loadingEmails, setLoadingEmails] = useState(false);

  const refreshAccounts = useCallback(async () => {
    try {
      const list = await api.getAccounts();
      setAccounts(list);
      if (list.length > 0 && !selectedLogin) {
        setSelectedLogin(list[0]?.login ?? null);
      }
    } catch (e) {
      console.error('ошибка загрузки аккаунтов', e);
    }
  }, [selectedLogin]);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  const handleSearch = useCallback(async (prompt: string) => {
    if (!selectedLogin) return;
    setLoadingEmails(true);
    setPanel({ kind: 'empty' });
    try {
      const result = await api.smartSearch({ accountLogin: selectedLogin, prompt });
      setEmails(result.messages);
    } catch (e) {
      setEmails([]);
      setPanel({ kind: 'analyze', analysis: '', loading: false, error: errMsg(e) });
    } finally {
      setLoadingEmails(false);
    }
  }, [selectedLogin]);

  /** Поиск писем по структурированным критериям (для форм analyze/analyze-attachments).
   *  Заполняет левый список; выбор письма запускает анализ в зависимости от режима. */
  const handleSearchByCriteria = useCallback(async (criteria: { subject?: string; from?: string; date?: string }) => {
    if (!selectedLogin) return;
    setLoadingEmails(true);
    try {
      const result = await api.searchEmails({ accountLogin: selectedLogin, criteria });
      setEmails(result.messages);
      if (result.messages.length === 0) {
        setPanel({ kind: 'analyze', analysis: '', loading: false, error: 'Ничего не найдено по критериям.' });
      }
    } catch (e) {
      setEmails([]);
      setPanel({ kind: 'analyze', analysis: '', loading: false, error: errMsg(e) });
    } finally {
      setLoadingEmails(false);
    }
  }, [selectedLogin]);

  const handleSelectEmail = useCallback(async (msg: EmailMessage) => {
    if (!selectedLogin) return;
    setPanel({ kind: 'empty' });
    try {
      const email = await api.getEmail(selectedLogin, msg.uid);
      setPanel({ kind: 'email', email });
    } catch (e) {
      setPanel({ kind: 'analyze', analysis: '', loading: false, error: errMsg(e) });
    }
  }, [selectedLogin]);

  const handleAnalyze = useCallback(async (uid: number) => {
    if (!selectedLogin) return;
    setPanel({ kind: 'analyze', analysis: '', loading: true });
    try {
      const result = await api.analyze({ accountLogin: selectedLogin, uid });
      setPanel({ kind: 'analyze', analysis: result.analysis, loading: false, ...(result.analysisError ? { error: result.analysisError } : {}) });
    } catch (e) {
      setPanel({ kind: 'analyze', analysis: '', loading: false, error: errMsg(e) });
    }
  }, [selectedLogin]);

  const handleAnalyzeMany = useCallback(async (criteria: { subject?: string; from?: string; dateFrom?: string; dateTo?: string }) => {
    if (!selectedLogin) return;
    setPanel({ kind: 'analyzeMany', analysis: '', loading: true });
    try {
      const result = await api.analyzeMany({ accountLogin: selectedLogin, criteria });
      setPanel({ kind: 'analyzeMany', analysis: result.analysis, loading: false, ...(result.analysisError ? { error: result.analysisError } : {}) });
    } catch (e) {
      setPanel({ kind: 'analyzeMany', analysis: '', loading: false, error: errMsg(e) });
    }
  }, [selectedLogin]);

  const handleAnalyzeAttachments = useCallback(async (uid: number) => {
    if (!selectedLogin) return;
    setPanel({ kind: 'analyzeAttachments', analysis: '', loading: true, skipped: [] });
    try {
      const result = await api.analyzeAttachments({ accountLogin: selectedLogin, uid });
      setPanel({
        kind: 'analyzeAttachments',
        analysis: result.analysis,
        loading: false,
        skipped: result.skipped ?? [],
        ...(result.analysisError ? { error: result.analysisError } : {}),
      });
    } catch (e) {
      setPanel({ kind: 'analyzeAttachments', analysis: '', loading: false, skipped: [], error: errMsg(e) });
    }
  }, [selectedLogin]);

  // Режим выбора письма в левом списке: что делает клик (просмотр/анализ/анализ вложений).
  const selectionMode: SelectionMode =
    panel.kind === 'analyzeForm' || panel.kind === 'analyze' ? 'analyze'
      : panel.kind === 'analyzeAttachmentsForm' || panel.kind === 'analyzeAttachments' ? 'analyzeAttachments'
        : 'view';

  // onSelect зависит от режима: в режимах analyze клик по письму запускает анализ.
  const handleSelectInList = useCallback((msg: EmailMessage) => {
    if (selectionMode === 'analyze') {
      void handleAnalyze(msg.uid);
    } else if (selectionMode === 'analyzeAttachments') {
      void handleAnalyzeAttachments(msg.uid);
    } else {
      void handleSelectEmail(msg);
    }
  }, [selectionMode, handleAnalyze, handleAnalyzeAttachments, handleSelectEmail]);

  const handleAccountAdded = useCallback(async () => {
    setShowAddAccount(false);
    await refreshAccounts();
  }, [refreshAccounts]);

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ display: 'flex', height: '100vh' }}>
        <CommandToolbar
          onSmartSearch={() => setPanel({ kind: 'search' })}
          onAnalyze={() => setPanel({ kind: 'analyzeForm' })}
          onAnalyzeMany={() => setPanel({ kind: 'analyzeManyForm' })}
          onAnalyzeAttachments={() => setPanel({ kind: 'analyzeAttachmentsForm' })}
          onSmartSend={() => setPanel({ kind: 'smartSend' })}
          onAddAccount={() => setShowAddAccount(true)}
          accountSelector={
            <AccountSelector
              accounts={accounts}
              selectedLogin={selectedLogin}
              onSelect={setSelectedLogin}
            />
          }
        />
        {/* Список писем слева */}
        <Box
          component="nav"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            borderRight: 1,
            borderColor: 'divider',
            overflowY: 'auto',
            mt: 8,
          }}
        >
          {loadingEmails ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress />
            </Box>
          ) : (
            <EmailList
              emails={emails}
              onSelect={handleSelectInList}
              hint={
                selectionMode === 'analyze'
                  ? 'Выберите письмо для анализа содержимого.'
                  : selectionMode === 'analyzeAttachments'
                    ? 'Выберите письмо для анализа вложений.'
                    : undefined
              }
            />
          )}
        </Box>
        {/* Основная зона справа */}
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 3,
            overflowY: 'auto',
            mt: 8,
          }}
        >
          {panel.kind === 'empty' && (
            <SmartSearchForm onSearch={handleSearch} disabled={!selectedLogin} />
          )}
          {panel.kind === 'search' && (
            <SmartSearchForm onSearch={handleSearch} disabled={!selectedLogin} />
          )}
          {panel.kind === 'analyzeForm' && (
            <AnalyzeForm onSearch={handleSearchByCriteria} disabled={!selectedLogin} />
          )}
          {panel.kind === 'analyzeAttachmentsForm' && (
            <AnalyzeAttachmentsForm onSearch={handleSearchByCriteria} disabled={!selectedLogin} />
          )}
          {panel.kind === 'analyzeManyForm' && (
            <AnalyzeManyForm onAnalyze={handleAnalyzeMany} />
          )}
          {panel.kind === 'email' && (
            <EmailView
              email={panel.email}
              accountLogin={selectedLogin ?? ''}
              onAnalyze={handleAnalyze}
              onAnalyzeAttachments={handleAnalyzeAttachments}
            />
          )}
          {panel.kind === 'analyze' && (
            <AnalyzePanel
              title="Анализ письма"
              analysis={panel.analysis}
              loading={panel.loading}
              error={panel.error}
            />
          )}
          {panel.kind === 'analyzeMany' && (
            <AnalyzePanel
              title="Анализ писем"
              analysis={panel.analysis}
              loading={panel.loading}
              error={panel.error}
            />
          )}
          {panel.kind === 'analyzeAttachments' && (
            <AnalyzePanel
              title="Анализ вложений"
              analysis={panel.analysis}
              loading={panel.loading}
              error={panel.error}
              skipped={panel.skipped}
            />
          )}
          {panel.kind === 'smartSend' && (
            <SmartSendForm accountLogin={selectedLogin ?? ''} />
          )}
          {!selectedLogin && (
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              Выберите аккаунт вверху или добавьте новый через «Add Account».
            </Typography>
          )}
        </Box>
      </Box>
      <AddAccountForm open={showAddAccount} onClose={() => setShowAddAccount(false)} onSaved={handleAccountAdded} />
    </ThemeProvider>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
