/**
 * Выбор аккаунта через дропдаун (change web-interface, design D4).
 *
 * Загружается в App; здесь только рендер дропдауна. При отсутствии аккаунтов —
 * подсказка «добавьте аккаунт».
 */
import { FormControl, InputLabel, MenuItem, Select, Typography, Box } from '@mui/material';
import type { AccountPublic } from '../api';

interface Props {
  accounts: AccountPublic[];
  selectedLogin: string | null;
  onSelect: (login: string) => void;
}

export function AccountSelector({ accounts, selectedLogin, onSelect }: Props): JSX.Element {
  if (accounts.length === 0) {
    return (
      <Box sx={{ mr: 2 }}>
        <Typography variant="body2" color="warning.main">
          Нет аккаунтов. Добавьте через «Add Account».
        </Typography>
      </Box>
    );
  }
  return (
    <FormControl size="small" sx={{ minWidth: 240, mr: 2 }}>
      <InputLabel id="account-select-label">Аккаунт</InputLabel>
      <Select
        labelId="account-select-label"
        label="Аккаунт"
        value={selectedLogin ?? ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        {accounts.map((a) => (
          <MenuItem key={a.login} value={a.login}>
            {a.login} ({a.provider})
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
