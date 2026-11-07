/**
 * Тулбар команд (AppBar) — change web-interface, design D4.
 *
 * Кнопки команд: Smart Search, Analyze Many, Smart Send, Add Account +
 * слот для AccountSelector.
 */
import { AppBar, Toolbar, Button, Box } from '@mui/material';
import { Search as SearchIcon, Analytics as AnalyzeIcon, Send as SendIcon, Add as AddIcon } from '@mui/icons-material';

interface Props {
  onSmartSearch: () => void;
  onAnalyze: () => void;
  onAnalyzeMany: () => void;
  onAnalyzeAttachments: () => void;
  onSmartSend: () => void;
  onAddAccount: () => void;
  accountSelector: React.ReactNode;
}

export function CommandToolbar(props: Props): JSX.Element {
  return (
    <AppBar position="fixed" color="default" elevation={1}>
      <Toolbar>
        {props.accountSelector}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button size="small" startIcon={<AnalyzeIcon />} onClick={props.onAnalyze}>
            Analyze
          </Button>
          <Button size="small" startIcon={<AnalyzeIcon />} onClick={props.onAnalyzeAttachments}>
            Analyze Attachments
          </Button>
          <Button size="small" startIcon={<SendIcon />} onClick={props.onSmartSend}>
            Smart Send
          </Button>
          <Button size="small" startIcon={<AnalyzeIcon />} onClick={props.onAnalyzeMany}>
            Analyze Many (BETA)
          </Button>
          <Button size="small" startIcon={<SearchIcon />} onClick={props.onSmartSearch}>
            Smart Search (BETA)
          </Button>
          <Button size="small" startIcon={<AddIcon />} onClick={props.onAddAccount}>
            Add Account
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
